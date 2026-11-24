"""Getting the full-length audio of a song from a source that authorises downloading it.

Sources, in order:
1. YouTube, only when the download is authorised:
   * the video is published under Creative Commons (CC BY), which YouTube shows as its licence
     (`status.license == "creativeCommon"`; on by default, `YT_ALLOW_CREATIVE_COMMONS=0` turns it off), or
   * the video's channel is on the owner's list `YT_AUTHORIZED_CHANNELS` (channel ids the owner holds the
     rights for or has written permission to use, e.g. the owner's own channel).
   Standard-licence videos are never downloaded: the bot gives their official YouTube link instead.
   Nothing here bypasses DRM, sign-in, age or region restrictions: yt-dlp runs without cookies or
   credentials and only takes formats YouTube plays to everyone.
2. Jamendo (`JAMENDO_CLIENT_ID`): full tracks whose artists allowed downloads (`audiodownload_allowed`),
   each with its Creative Commons licence.

Every file is checked (decodes cleanly, full length, not a preview) and converted to one MP3 setting.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import requests

from . import audio, config
from .textutil import norm, similarity, split_artists, strip_feat
from .youtube import Video

MP3_ARGS = ["-c:a", "libmp3lame", "-b:a", "256k", "-ar", "44100"]  # one quality setting for every acquired file
MAX_SECONDS = 15 * 60
MAX_BYTES = 150 * 1024 * 1024
MIN_SECONDS = 60          # anything shorter is a preview / clip, not a full song
JAMENDO_API = "https://api.jamendo.com/v3.0/tracks/"
_YT_CHANNEL = re.compile(r"^UC[\w-]{22}$")


class AcquireError(RuntimeError):
    """Expected failure with a message that is safe to show to the user (no secrets, no URLs with keys)."""


@dataclass
class Acquired:
    path: Path                 # the MP3, ready for the station's import pipeline
    provider: str              # "youtube" | "jamendo"
    source_id: str             # stable id at the provider -> duplicate detection across runs
    url: str                   # public page of the source
    license: str               # human readable licence / permission
    license_url: str | None
    attribution: str           # who to credit (required by CC BY)
    duration: float
    extra: dict = field(default_factory=dict)

    @property
    def stable_key(self) -> str:
        return f"{self.provider}:{self.source_id}"

    def origin(self) -> dict:
        return {"provider": self.provider, "id": self.source_id, "url": self.url, "license": self.license,
                "licenseUrl": self.license_url, "attribution": self.attribution, **self.extra}


# ------------------------------------------------------------------ permission
def authorized_channels() -> set[str]:
    return {c for c in re.split(r"[,\s]+", config.YT_AUTHORIZED_CHANNELS) if _YT_CHANNEL.match(c)}


def youtube_permission(video: Video) -> tuple[bool, str]:
    """(allowed, reason). Only explicit permission counts; "it's on YouTube" is not permission."""
    if video.channel_id in authorized_channels():
        return True, "egasi ruxsat bergan kanal (YT_AUTHORIZED_CHANNELS)"
    if video.license == "creativeCommon":
        if config.YT_ALLOW_CREATIVE_COMMONS:
            return True, "Creative Commons Attribution (CC BY)"
        return False, "Creative Commons, lekin YT_ALLOW_CREATIVE_COMMONS o'chirilgan"
    return False, "standart YouTube litsenziyasi — yuklab olishga ruxsat yo'q"


# ------------------------------------------------------------------ validation / mp3
def validate(path: Path, expected: float = 0.0) -> audio.AudioInfo:
    """A complete, playable song: audio stream, decodes without errors, full length."""
    if not path.exists() or path.stat().st_size < 50_000:
        raise AcquireError("fayl bo'sh yoki juda kichik")
    info = audio.probe(path)
    if not info.has_audio:
        raise AcquireError("faylda audio yo'q")
    if info.duration < MIN_SECONDS:
        raise AcquireError(f"fayl juda qisqa ({int(info.duration)} s) — bu preview, to'liq qo'shiq emas")
    if info.duration > MAX_SECONDS:
        raise AcquireError("fayl juda uzun (15 daqiqadan ortiq)")
    if expected and info.duration < expected * 0.85:
        raise AcquireError(f"fayl to'liq emas ({int(info.duration)} s, kutilgan ~{int(expected)} s)")
    # ffmpeg exits 0 even when frames fail to decode, so the decoder errors themselves are counted.
    # (One or two glitches happen in real-world files; damaged/truncated files produce many.)
    proc = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-f", "null", "-"],
                          capture_output=True, text=True, timeout=300)
    errors = [line for line in (proc.stderr or "").splitlines() if line.strip()]
    if proc.returncode != 0 or len(errors) > 3:
        raise AcquireError("audio buzilgan (to'liq dekodlanmadi)")
    return info


def to_mp3(src: Path, dest: Path, meta: dict[str, str]) -> Path:
    tags: list[str] = []
    for key, value in meta.items():
        if value:
            tags += ["-metadata", f"{key}={value}"]
    proc = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-map", "0:a:0", "-vn", "-map_metadata", "-1",
                           *MP3_ARGS, *tags, "-id3v2_version", "3", str(dest)],
                          capture_output=True, text=True, timeout=900)
    if proc.returncode != 0 or not dest.exists():
        raise AcquireError("MP3 ga o'girib bo'lmadi")
    return dest


# ------------------------------------------------------------------ YouTube (authorised only)
def youtube_audio(video: Video, workdir: Path, meta: dict[str, str]) -> Acquired:
    allowed, reason = youtube_permission(video)
    if not allowed:
        raise AcquireError(f"YouTube yuklashga ruxsat yo'q: {reason}")
    try:
        import yt_dlp
    except ImportError as exc:
        raise AcquireError("yt-dlp o'rnatilmagan") from exc

    options = {
        "format": "bestaudio/best",
        "outtmpl": str(workdir / "yt.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 20,
        "retries": 2,
        "fragment_retries": 2,
        "max_filesize": MAX_BYTES,
        "allow_unplayable_formats": False,  # never DRM-protected streams
        "cookiefile": None,
    }
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(video.url, download=True)
    except Exception as exc:
        text = str(exc).lower()
        if "sign in" in text or "bot" in text or "login" in text or "age" in text:
            raise AcquireError("YouTube bu serverdan yuklashni chekladi (kirish talab qilinadi) — chetlab o'tilmaydi")
        raise AcquireError("YouTube'dan audio olinmadi") from None
    # The licence can change after the search: check the downloaded video's own metadata again.
    if (info.get("channel_id") or video.channel_id) != video.channel_id:
        raise AcquireError("yuklangan video boshqa kanalga tegishli")
    live_license = (info.get("license") or "").lower()
    if video.channel_id not in authorized_channels() and "creative commons" not in live_license:
        raise AcquireError("video endi Creative Commons litsenziyasida emas")
    files = [p for p in workdir.glob("yt.*") if p.suffix != ".part"]
    if not files:
        raise AcquireError("YouTube audio fayli topilmadi")
    validate(files[0], video.duration)
    mp3 = to_mp3(files[0], workdir / "youtube.mp3", meta)
    info2 = validate(mp3, video.duration)
    licence_url = "https://creativecommons.org/licenses/by/3.0/legalcode" if video.license == "creativeCommon" else None
    return Acquired(mp3, "youtube", video.id, video.url, reason, licence_url,
                    f"{video.channel} (YouTube)", info2.duration,
                    {"channel": video.channel, "channelId": video.channel_id, "kind": video.kind})


# ------------------------------------------------------------------ Jamendo
def _jamendo_host_ok(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return urlsplit(url).scheme == "https" and (host == "jamendo.com" or host.endswith(".jamendo.com"))


def jamendo_find(title: str, artist: str, duration: float = 0.0) -> dict | None:
    if not config.JAMENDO_CLIENT_ID:
        return None
    try:
        resp = requests.get(JAMENDO_API, params={
            "client_id": config.JAMENDO_CLIENT_ID, "format": "json", "limit": 20,
            "search": f"{artist} {strip_feat(title)[0]}".strip(), "audiodownload_allowed": "true",
            "include": "licenses", "audioformat": "mp32"}, timeout=20)
        data = resp.json() if resp.status_code == 200 else {}
    except (requests.RequestException, ValueError):
        return None
    if (data.get("headers") or {}).get("status") not in (None, "success"):
        return None
    best, best_score = None, 0.0
    keys = [norm(a) for a in split_artists(artist)] or [norm(artist)]
    for row in data.get("results", []):
        if not row.get("audiodownload_allowed") or not row.get("audiodownload"):
            continue
        t = similarity(row.get("name", ""), strip_feat(title)[0])
        a = max((similarity(row.get("artist_name", ""), k) for k in keys if k), default=0.0)
        if t < 0.85 or a < 0.85:
            continue
        s = t + a - (0.3 if duration and abs((row.get("duration") or 0) - duration) > 15 else 0)
        if s > best_score:
            best, best_score = row, s
    return best


def jamendo_audio(row: dict, workdir: Path, meta: dict[str, str]) -> Acquired:
    url = row.get("audiodownload") or ""
    if not _jamendo_host_ok(url):
        raise AcquireError("Jamendo havolasi noto'g'ri")
    src = workdir / "jamendo.src"
    size = 0
    try:
        with requests.get(url, stream=True, timeout=(15, 120)) as resp:
            resp.raise_for_status()
            if not _jamendo_host_ok(resp.url):
                raise AcquireError("Jamendo fayli boshqa saytga yo'naltirildi")
            with src.open("wb") as fh:
                for chunk in resp.iter_content(256 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise AcquireError("Jamendo fayli juda katta")
                    fh.write(chunk)
    except requests.RequestException:
        raise AcquireError("Jamendo'dan yuklab bo'lmadi") from None
    expected = float(row.get("duration") or 0)
    validate(src, expected)
    mp3 = to_mp3(src, workdir / "jamendo.mp3", meta)
    info = validate(mp3, expected)
    licence_url = row.get("license_ccurl") or None
    licence = "Creative Commons"
    if licence_url:
        m = re.search(r"/licenses/([a-z\-]+)/", licence_url)
        licence = f"CC {m.group(1).upper()}" if m else licence
    return Acquired(mp3, "jamendo", str(row.get("id")), row.get("shareurl") or "https://www.jamendo.com",
                    licence, licence_url, row.get("artist_name") or "", info.duration)
