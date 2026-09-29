"""Audio helpers built on ffmpeg/ffprobe and mutagen."""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import mutagen


@dataclass
class AudioInfo:
    duration: float = 0.0
    codec: str = ""
    container: str = ""
    bitrate: int = 0
    has_audio: bool = False
    has_video: bool = False  # a real video track (not just embedded cover art)
    tags: dict[str, str] = field(default_factory=dict)


def _run(cmd: list[str], timeout: int = 300) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def probe(path: Path) -> AudioInfo:
    proc = _run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
    info = AudioInfo()
    if proc.returncode != 0:
        return info
    data = json.loads(proc.stdout or "{}")
    fmt = data.get("format", {})
    info.container = fmt.get("format_name", "")
    info.duration = float(fmt.get("duration") or 0)
    info.bitrate = int(fmt.get("bit_rate") or 0)
    for key, value in (fmt.get("tags") or {}).items():
        info.tags[key.lower()] = str(value)
    for stream in data.get("streams", []):
        kind = stream.get("codec_type")
        if kind == "audio" and not info.has_audio:
            info.has_audio = True
            info.codec = stream.get("codec_name", "")
            if not info.duration:
                info.duration = float(stream.get("duration") or 0)
            if stream.get("bit_rate"):
                info.bitrate = int(stream["bit_rate"])
            for key, value in (stream.get("tags") or {}).items():
                info.tags.setdefault(key.lower(), str(value))
        elif kind == "video" and not (stream.get("disposition") or {}).get("attached_pic"):
            if stream.get("codec_name") not in ("mjpeg", "png", "bmp"):
                info.has_video = True
    return info


def fix_mojibake(text: str) -> str:
    """Repair cp1251 text that was decoded as latin-1 (very common in old CIS mp3 tags)."""
    if not text or not re.search(r"[\xc0-\xff]", text):
        return text
    try:
        fixed = text.encode("latin-1").decode("cp1251")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text
    return fixed if re.search(r"[\u0400-\u04FF]", fixed) else text


def read_tags(path: Path, info: AudioInfo) -> dict[str, str]:
    tags: dict[str, str] = {}
    try:
        f = mutagen.File(path, easy=True)
        if f is not None and f.tags:
            for key in ("title", "artist", "album", "albumartist", "date", "genre"):
                val = f.tags.get(key)
                if val:
                    tags[key] = str(val[0] if isinstance(val, list) else val)
    except Exception as exc:  # broken tags must never stop the import
        print(f"[audio] mutagen: {exc}")
    for key in ("title", "artist", "album", "album_artist", "date", "genre"):
        if info.tags.get(key) and key.replace("_", "") not in tags:
            tags[key.replace("_", "")] = info.tags[key]
    return {k: fix_mojibake(v.strip()) for k, v in tags.items() if v and v.strip()}


def extract_picture(path: Path, dest: Path, info: AudioInfo) -> Path | None:
    """Embedded cover art, or a frame from a music video."""
    cmd = ["ffmpeg", "-y", "-v", "error"]
    if info.has_video and info.duration > 10:
        cmd += ["-ss", f"{info.duration * 0.3:.1f}"]
    cmd += ["-i", str(path), "-map", "0:v:0", "-frames:v", "1", "-an", str(dest)]
    proc = _run(cmd, timeout=60)
    if proc.returncode == 0 and dest.exists() and dest.stat().st_size > 1000:
        return dest
    return None


def excerpt(path: Path, dest: Path, info: AudioInfo, seconds: int = 18) -> Path | None:
    """Short mono clip from the middle of the song (for audio fingerprinting)."""
    start = max(0.0, min(info.duration * 0.35, info.duration - seconds - 1)) if info.duration else 0
    proc = _run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.1f}", "-t", str(seconds), "-i", str(path),
                 "-vn", "-ac", "1", "-ar", "16000", str(dest)], timeout=60)
    return dest if proc.returncode == 0 and dest.exists() else None


def loudness(path: Path) -> float | None:
    """Integrated loudness in LUFS (EBU R128)."""
    proc = _run(["ffmpeg", "-nostats", "-hide_banner", "-i", str(path), "-map", "0:a:0",
                 "-filter:a", "ebur128", "-f", "null", "-"], timeout=300)
    matches = re.findall(r"I:\s+(-?\d+(?:\.\d+)?) LUFS", proc.stderr or "")
    return float(matches[-1]) if matches else None


def encode(src: Path, dest_base: Path, info: AudioInfo, meta: dict[str, str]) -> tuple[Path, str]:
    """Write the final streaming file with clean tags. Returns (path, mime).

    mp3 and AAC are kept bit-exact (no quality loss); everything else becomes a
    high quality VBR mp3 so it plays on every device (incl. iOS).
    """
    container = info.container
    if info.codec == "mp3" and not info.has_video:
        dest, mime, codec_args = dest_base.with_suffix(".mp3"), "audio/mpeg", ["-c:a", "copy"]
    elif info.codec == "aac" and ("mp4" in container or "mov" in container or "aac" in container):
        dest, mime, codec_args = dest_base.with_suffix(".m4a"), "audio/mp4", ["-c:a", "copy", "-movflags", "+faststart"]
    else:
        dest, mime, codec_args = dest_base.with_suffix(".mp3"), "audio/mpeg", ["-c:a", "libmp3lame", "-q:a", "1"]

    meta_args: list[str] = []
    for key, value in meta.items():
        if value:
            meta_args += ["-metadata", f"{key}={value}"]
    extra = ["-id3v2_version", "3"] if dest.suffix == ".mp3" else []
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-map", "0:a:0", "-vn", "-map_metadata", "-1",
           *codec_args, *meta_args, *extra, str(dest)]
    proc = _run(cmd, timeout=600)
    if proc.returncode != 0 and "copy" in codec_args:
        # Stream copy can fail on damaged files -> re-encode instead.
        dest, mime = dest_base.with_suffix(".mp3"), "audio/mpeg"
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-map", "0:a:0", "-vn", "-map_metadata", "-1",
               "-c:a", "libmp3lame", "-q:a", "1", *meta_args, "-id3v2_version", "3", str(dest)]
        proc = _run(cmd, timeout=600)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr[-500:]}")
    return dest, mime
