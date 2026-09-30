"""The song library (library/songs.json) and where the audio files are stored."""
from __future__ import annotations

import functools
import hashlib
import json
import mimetypes
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from . import config
from .textutil import norm


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Library:
    def __init__(self) -> None:
        self.songs: list[dict[str, Any]] = []
        self.artists: dict[str, dict[str, Any]] = {}
        self.site: dict[str, Any] = {}
        self.dirty = False
        if config.SONGS_FILE.exists():
            data = json.loads(config.SONGS_FILE.read_text(encoding="utf-8") or "{}")
            self.songs = data.get("songs", [])
            self.artists = data.get("artists", {})
            self.site = data.get("site", {})

    # ------------------------------------------------------------------ queries
    def get(self, song_id: str) -> dict | None:
        return next((s for s in self.songs if s["id"] == song_id), None)

    def by_file(self, file_key: str) -> dict | None:
        return next((s for s in self.songs if s.get("fileKey") == file_key), None)

    def by_message(self, message_id: int) -> dict | None:
        return next((s for s in self.songs if message_id in (s.get("tg") or {}).get("msgs", [])), None)

    def duplicate_of(self, title: str, artist: str, duration: float) -> dict | None:
        key = (norm(title), norm(artist))
        for s in self.songs:
            if (norm(s["title"]), norm(s["artist"])) == key and abs(s.get("duration", 0) - duration) <= 4:
                return s
        return None

    # ------------------------------------------------------------------ changes
    def add(self, song: dict) -> None:
        self.songs.insert(0, song)
        self.dirty = True

    def update(self, song: dict, **fields: Any) -> None:
        song.update(fields)
        song["updatedAt"] = now_iso()
        self.dirty = True

    def remove(self, song: dict) -> None:
        delete_audio(song)
        for rel in (song.get("cover"), song.get("story"), f"library/lyrics/{song['id']}.json"):
            if rel and not rel.startswith("http"):
                (config.ROOT / rel).unlink(missing_ok=True)
        self.songs = [s for s in self.songs if s["id"] != song["id"]]
        self.dirty = True

    def save(self) -> None:
        if not self.dirty:
            return
        config.SONGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        used = {a for s in self.songs for a in s.get("artists", [])}
        for name in [k for k in self.artists if k not in used]:
            image = self.artists.pop(name).get("image")
            if image:
                (config.ROOT / image).unlink(missing_ok=True)
        payload = {"version": 1, "updatedAt": now_iso(), "count": len(self.songs), "site": self.site,
                   "artists": self.artists, "songs": self.songs}
        tmp = config.SONGS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(config.SONGS_FILE)
        self.dirty = False

    def mark_admin(self, user_id: int) -> None:
        """Lets the site show the owner's tools (Add page). Only a slow hash of the Telegram id is published."""
        digest = admin_key(user_id)
        admins = self.site.setdefault("admins", [])
        if digest not in admins:
            admins.append(digest)
            self.dirty = True

    def set_artist_image(self, name: str, url: str | None) -> None:
        """Downloads the official artist photo once and stores it with the artist profile."""
        profile = self.artists.setdefault(name, {"aliases": [], "verified": False})
        if not url or profile.get("image"):
            return
        from .covers import save_cover
        from .lookup import download_image

        data = download_image(url)
        if not data:
            return
        slug = re.sub(r"[^a-z0-9]+", "-", norm(name)).strip("-")[:40] or hashlib.sha1(name.encode()).hexdigest()[:10]
        dest = config.ARTISTS_DIR / f"{slug}.jpg"
        color = save_cover(data, dest)
        if color:
            profile.update(image=f"library/artists/{dest.name}", color=color)
            self.dirty = True

    # ------------------------------------------------------------------ stats
    def total_duration(self) -> float:
        return sum(s.get("duration", 0) for s in self.songs)

    def pages_audio_bytes(self) -> int:
        # Computed from songs.json: the bot's checkout skips library/audio to stay fast.
        audio = sum(s.get("size") or 0 for s in self.songs if s.get("src") and not s["src"].startswith("http"))
        video = sum(s.get("videoSize") or 0 for s in self.songs if s.get("video") and not s["video"].startswith("http"))
        return audio + video


# ---------------------------------------------------------------------- audio storage

def _gh(method: str, url: str, **kwargs: Any) -> requests.Response:
    headers = kwargs.pop("headers", {})
    headers.update({"Authorization": f"Bearer {config.GITHUB_TOKEN}", "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28"})
    return requests.request(method, url, headers=headers, timeout=kwargs.pop("timeout", 120), **kwargs)


def _release() -> dict:
    api = f"https://api.github.com/repos/{config.GITHUB_REPOSITORY}/releases"
    resp = _gh("GET", f"{api}/tags/{config.RELEASE_TAG}")
    if resp.status_code == 200:
        return resp.json()
    resp = _gh("POST", api, json={
        "tag_name": config.RELEASE_TAG, "name": "🎵 Audio library",
        "body": "Music station audio files (managed automatically by the bot).",
        "prerelease": True,
    })
    resp.raise_for_status()
    return resp.json()


def choose_storage(lib: Library, size: int) -> str:
    mode = config.AUDIO_STORAGE
    if mode in ("pages", "release"):
        return mode if (mode == "pages" or (config.GITHUB_TOKEN and config.GITHUB_REPOSITORY)) else "pages"
    limit = config.PAGES_AUDIO_LIMIT_MB * 1024 * 1024
    if lib.pages_audio_bytes() + size <= limit or not (config.GITHUB_TOKEN and config.GITHUB_REPOSITORY):
        return "pages"
    return "release"


@functools.lru_cache(maxsize=8)
def admin_key(user_id: int) -> str:
    """PBKDF2 (the site computes the same in the browser), so the owner's id can't be read back easily."""
    return hashlib.pbkdf2_hmac("sha256", str(user_id).encode(), b"cavi-music:admin", 150_000).hex()


def store_audio(lib: Library, path: Path, song_id: str, mime: str) -> tuple[str, str]:
    """Stores the final audio file. Returns (src url relative to the site root or absolute, storage kind)."""
    return store_file(lib, path, f"{song_id}{path.suffix}", mime)


def store_file(lib: Library, path: Path, name: str, mime: str) -> tuple[str, str]:
    """Stores a media file on the site (library/audio/) or, once the site is full, in GitHub Releases."""
    size = path.stat().st_size
    kind = choose_storage(lib, size)
    if kind == "release":
        release = _release()
        upload = release["upload_url"].split("{")[0]
        with open(path, "rb") as fh:
            resp = _gh("POST", upload, params={"name": name}, data=fh,
                       headers={"Content-Type": mime or mimetypes.guess_type(name)[0] or "application/octet-stream"},
                       timeout=600)
        if resp.status_code == 422:  # already uploaded (re-run) -> reuse
            asset = next((a for a in release.get("assets", []) if a["name"] == name), None)
            if asset:
                return asset["browser_download_url"], kind
        resp.raise_for_status()
        return resp.json()["browser_download_url"], kind
    config.AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    dest = config.AUDIO_DIR / name
    shutil.copyfile(path, dest)
    return f"library/audio/{name}", kind


def _git_rm(rel: str) -> None:
    """Remove a file from git even when it is outside the sparse checkout."""
    try:
        subprocess.run(["git", "rm", "-q", "--cached", "--ignore-unmatch", "--sparse", "--", rel],
                       cwd=config.ROOT, capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        pass
    (config.ROOT / rel).unlink(missing_ok=True)


def delete_audio(song: dict) -> None:
    delete_media(song.get("src") or "")
    delete_media(song.get("video") or "")


def delete_media(src: str) -> None:
    if not src:
        return
    if not src.startswith("http"):
        _git_rm(src)
        return
    if not (config.GITHUB_TOKEN and config.GITHUB_REPOSITORY):
        return
    try:
        release = _release()
        name = src.rsplit("/", 1)[-1]
        for asset in release.get("assets", []):
            if asset["name"] == name:
                _gh("DELETE", asset["url"])
    except requests.RequestException as exc:
        print(f"[library] could not delete release asset: {exc}")
