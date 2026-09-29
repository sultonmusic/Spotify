"""Finds the official YouTube video/audio of a song (for songs added by name).

Nothing is downloaded: the site plays these songs through YouTube's official
embedded player, so the artist's channel keeps its views.
"""
from __future__ import annotations

import math
import re

import requests

from .textutil import norm, similarity

JUNK = re.compile(
    r"\b(live|concert|konsert|концерт|cover|кавер|karaoke|караоке|minus|минус|instrumental|slowed|sped ?up|"
    r"reverb|8d|nightcore|bass boosted|remix|ремикс|mashup|reaction|реакция|1 hour|10 hours|tekst|текст|"
    r"lyrics?|qo'?shiq matni|shorts|tiktok|edit|acoustic|piano version)\b", re.I)


def _search(query: str, limit: int = 8) -> list[dict]:
    try:
        import yt_dlp
    except ImportError:
        print("[youtube] yt-dlp is not installed")
        return []
    opts = {"quiet": True, "no_warnings": True, "extract_flat": True, "skip_download": True, "socket_timeout": 20}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            data = ydl.extract_info(f"ytsearch{limit}:{query}", download=False) or {}
    except Exception as exc:  # network / YouTube changes must not crash the bot
        print(f"[youtube] search failed: {exc}")
        return []
    return [e for e in data.get("entries") or [] if e and e.get("id")]


def _score(e: dict, artist: str, title: str, duration: float) -> float:
    vt, ch = e.get("title") or "", e.get("channel") or e.get("uploader") or ""
    s = max(similarity(f"{artist} {title}", vt), similarity(f"{artist} - {title}", vt), similarity(title, vt) * 0.85)
    if norm(title) not in norm(vt):
        s -= 0.25
    topic = ch.endswith(" - Topic")
    if topic and similarity(ch[:-8], artist) >= 0.8:
        s += 0.4  # YouTube Music "Topic" channel = official studio audio
    elif similarity(ch, artist) >= 0.8 or norm(artist) in norm(ch):
        s += 0.3  # the artist's own channel
    if e.get("channel_is_verified"):
        s += 0.1
    wanted = set(JUNK.findall(title.lower()))
    unwanted = {w.lower() for w in JUNK.findall(vt)} - {w.lower() for w in wanted}
    if unwanted:
        s -= 0.35
    d = e.get("duration") or 0
    if duration and d:
        diff = abs(duration - d)
        s += 0.15 if diff <= 4 else 0.05 if diff <= 12 else -0.35 if diff > 40 else -0.1
    views = e.get("view_count") or 0
    s += min(0.1, math.log10(views + 1) / 80)
    return s


def embeddable(video_id: str) -> bool | None:
    """False when the uploader disabled embedding (the site could not play it). None = unknown."""
    try:
        resp = requests.get("https://www.youtube.com/oembed",
                            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"}, timeout=10)
    except requests.RequestException:
        return None
    if resp.status_code == 200:
        return True
    if resp.status_code in (401, 403, 404):
        return False
    return None


def find_videos(artist: str, title: str, duration: float = 0) -> list[str]:
    """Up to 4 embeddable video ids, best first (the site falls back to the next one if one can't play)."""
    seen: dict[str, float] = {}
    for query in (f"{artist} - {title} official audio", f"{artist} {title}"):
        for e in _search(query):
            sc = _score(e, artist, title, duration)
            if sc > seen.get(e["id"], -9):
                seen[e["id"]] = sc
        if seen and max(seen.values()) >= 1.1:
            break
    ranked = [vid for vid, sc in sorted(seen.items(), key=lambda x: -x[1]) if sc >= 0.55]
    return [vid for vid in ranked[:8] if embeddable(vid) is not False][:4]
