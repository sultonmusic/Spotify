"""Song identification from public music services.

* Shazam (audio fingerprint) - recognises the song from the sound itself
* iTunes Search API        - title/artist/album/genre/year/artwork
* Deezer API               - second catalogue: bpm, album genre, artwork
* LRCLIB                   - synced (karaoke) and plain lyrics
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

import requests

from .textutil import norm, similarity, split_artists

UA = {"User-Agent": "MusicStation/1.0 (+https://github.com/topics/telegram-music-bot)"}
_session = requests.Session()
_session.headers.update(UA)


def _get(url: str, params: dict | None = None, timeout: int = 15) -> Any:
    try:
        resp = _session.get(url, params=params, timeout=timeout)
        if resp.status_code != 200:
            return None
        return resp.json()
    except (requests.RequestException, ValueError) as exc:
        print(f"[lookup] {url}: {exc}")
        return None


# --------------------------------------------------------------------------- Shazam

def shazam(clip: Path) -> dict | None:
    try:
        from shazamio import Shazam  # optional dependency
    except Exception as exc:
        print(f"[shazam] unavailable: {exc}")
        return None

    async def _recognize() -> dict:
        return await Shazam().recognize(str(clip))

    try:
        data = asyncio.run(asyncio.wait_for(_recognize(), timeout=45))
    except Exception as exc:
        print(f"[shazam] {exc}")
        return None
    track = (data or {}).get("track")
    if not track:
        return None
    images = track.get("images") or {}
    cover = images.get("coverarthq") or images.get("coverart")
    result: dict[str, Any] = {
        "title": track.get("title", ""),
        "artist": track.get("subtitle", ""),
        "genre": (track.get("genres") or {}).get("primary", ""),
        "cover": re.sub(r"/\d+x\d+cc\.jpg$", "/800x800cc.jpg", cover) if cover else None,
        "isrc": track.get("isrc"),
    }
    for section in track.get("sections") or []:
        for meta in section.get("metadata") or []:
            label, text = (meta.get("title") or "").lower(), meta.get("text") or ""
            if label == "album":
                result["album"] = text
            elif label == "released" and re.match(r"\d{4}", text):
                result["year"] = int(text[:4])
            elif label == "label":
                result["label"] = text
    return result


# --------------------------------------------------------------------------- catalogues

def _score(cand_title: str, cand_artist: str, cand_duration: float, title: str, artist: str, duration: float) -> float:
    t = similarity(cand_title, title) if title else 0.0
    a = similarity(cand_artist, artist) if artist else 0.5
    # Artist sometimes ends up in the title field ("Artist - Title" as title).
    if not artist and title:
        t = max(t, similarity(f"{cand_artist} {cand_title}", title))
    score = t * 0.6 + a * 0.4
    if duration and cand_duration:
        diff = abs(duration - cand_duration)
        score += 0.1 if diff <= 3 else 0.03 if diff <= 10 else -0.15 if diff > 40 else 0
    return score


def itunes(title: str, artist: str, duration: float) -> dict | None:
    term = f"{artist} {title}".strip()
    if not term:
        return None
    best, best_score = None, 0.0
    for country in ("US", "RU"):
        data = _get("https://itunes.apple.com/search",
                    {"term": term, "entity": "song", "media": "music", "limit": 15, "country": country})
        for r in (data or {}).get("results", []):
            s = _score(r.get("trackName", ""), r.get("artistName", ""), (r.get("trackTimeMillis") or 0) / 1000,
                       title, artist, duration)
            if s > best_score:
                best, best_score = r, s
        if best_score >= 0.85:
            break
    if not best:
        return None
    art = best.get("artworkUrl100") or ""
    return {
        "score": round(best_score, 3),
        "title": best.get("trackName", ""),
        "artist": best.get("artistName", ""),
        "album": re.sub(r"\s*-\s*(Single|EP)$", "", best.get("collectionName", "") or ""),
        "genre": best.get("primaryGenreName", ""),
        "year": int(best["releaseDate"][:4]) if best.get("releaseDate") else None,
        "duration": (best.get("trackTimeMillis") or 0) / 1000,
        "cover": art.replace("100x100bb", "600x600bb") if art else None,
        "explicit": best.get("trackExplicitness") == "explicit",
    }


def deezer(title: str, artist: str, duration: float) -> dict | None:
    queries = []
    if artist and title:
        queries.append(f'artist:"{artist}" track:"{title}"')
    queries.append(f"{artist} {title}".strip())
    best, best_score = None, 0.0
    for q in queries:
        data = _get("https://api.deezer.com/search", {"q": q, "limit": 15})
        for r in (data or {}).get("data", []):
            s = _score(r.get("title", ""), (r.get("artist") or {}).get("name", ""), r.get("duration") or 0,
                       title, artist, duration)
            if s > best_score:
                best, best_score = r, s
        if best_score >= 0.85:
            break
    if not best:
        return None
    result: dict[str, Any] = {
        "score": round(best_score, 3),
        "title": best.get("title", ""),
        "artist": (best.get("artist") or {}).get("name", ""),
        "album": (best.get("album") or {}).get("title", ""),
        "duration": best.get("duration") or 0,
        "cover": (best.get("album") or {}).get("cover_xl"),
        "artist_picture": (best.get("artist") or {}).get("picture_xl"),
        "explicit": bool(best.get("explicit_lyrics")),
    }
    if best_score >= 0.7:
        track = _get(f"https://api.deezer.com/track/{best['id']}") or {}
        if track.get("bpm"):
            result["bpm"] = round(float(track["bpm"]))
        if track.get("release_date") and track["release_date"][:4].isdigit():
            result["year"] = int(track["release_date"][:4])
        contributors = [c.get("name") for c in track.get("contributors") or [] if c.get("name")]
        if contributors:
            result["artists"] = contributors
        album_id = (best.get("album") or {}).get("id")
        if album_id:
            album = _get(f"https://api.deezer.com/album/{album_id}") or {}
            genres = [g.get("name") for g in (album.get("genres") or {}).get("data", []) if g.get("name")]
            if genres:
                result["genre"] = genres[0]
    return result


# --------------------------------------------------------------------------- lyrics

def lyrics(title: str, artist: str, album: str, duration: float) -> dict | None:
    if not title:
        return None
    params = {"track_name": title, "artist_name": artist or "", "album_name": album or ""}
    if duration:
        params["duration"] = int(round(duration))
    data = _get("https://lrclib.net/api/get", params)
    if not data:
        found = _get("https://lrclib.net/api/search", {"track_name": title, "artist_name": artist or ""}) or []
        if not found and artist:
            found = _get("https://lrclib.net/api/search", {"q": f"{artist} {title}"}) or []
        best, best_score = None, 0.0
        for r in found if isinstance(found, list) else []:
            s = _score(r.get("trackName", ""), r.get("artistName", ""), r.get("duration") or 0, title, artist, duration)
            if r.get("syncedLyrics"):
                s += 0.05
            if s > best_score:
                best, best_score = r, s
        data = best if best_score >= 0.8 else None
    if not data:
        return None
    if data.get("instrumental"):
        return {"instrumental": True}
    synced, plain = data.get("syncedLyrics"), data.get("plainLyrics")
    if not synced and not plain:
        return None
    return {"synced": synced or None, "plain": plain or None}


def parse_lrc(lrc: str) -> list[list]:
    """'[01:23.45] line' -> [[83.45, 'line'], ...]"""
    lines = []
    for raw in (lrc or "").splitlines():
        stamps = re.findall(r"\[(\d+):(\d+(?:\.\d+)?)\]", raw)
        text = re.sub(r"\[[^\]]*\]", "", raw).strip()
        for mm, ss in stamps:
            lines.append([round(int(mm) * 60 + float(ss), 2), text])
    lines.sort(key=lambda x: x[0])
    return lines


def download_image(url: str) -> bytes | None:
    try:
        resp = _session.get(url, timeout=20)
        if resp.status_code == 200 and resp.content and len(resp.content) > 1000:
            return resp.content
    except requests.RequestException as exc:
        print(f"[lookup] image: {exc}")
    return None


def same_song(a_title: str, a_artist: str, b_title: str, b_artist: str) -> bool:
    return similarity(a_title, b_title) >= 0.85 and (
        not a_artist or not b_artist or similarity(a_artist, b_artist) >= 0.6
        or bool({norm(x) for x in split_artists(a_artist)} & {norm(x) for x in split_artists(b_artist)})
    )
