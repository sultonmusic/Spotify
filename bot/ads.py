"""Ads shown on the site (created with /add in the bot, listed with /ads).

Files live in library/ads/, the list in library/ads.json. The site shows an ad full-screen once a day
per listener (the music pauses, "skip" after 10 s) and silently in place of the cover at 50 s and 50 s
before the end of every song. Views, skips and clicks are counted by the relay (relay/worker.js).
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import time
from pathlib import Path

import requests
from PIL import Image, ImageOps

from . import config
from .library import now_iso

ADS_FILE = config.LIBRARY_DIR / "ads.json"
ADS_DIR = config.LIBRARY_DIR / "ads"
EVENTS = ("view", "iview", "skip", "complete", "click")


def load() -> list[dict]:
    try:
        return json.loads(ADS_FILE.read_text(encoding="utf-8")).get("ads", [])
    except (OSError, ValueError):
        return []


def save(ads: list[dict]) -> None:
    ADS_FILE.parent.mkdir(parents=True, exist_ok=True)
    ADS_FILE.write_text(json.dumps({"updatedAt": now_iso(), "ads": ads}, ensure_ascii=False, indent=1), encoding="utf-8")


def _probe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, timeout=60).stdout.strip()
    try:
        return float(out)
    except ValueError:
        return 0.0


def create(src: Path, kind: str, text: str, link: str) -> dict:
    """Prepares the ad's media for the web and adds it to the list. kind: image | video."""
    ad_id = hashlib.sha1(f"{src.name}{time.time()}".encode()).hexdigest()[:10]
    ADS_DIR.mkdir(parents=True, exist_ok=True)
    ad = {"id": ad_id, "type": kind, "text": text.strip()[:300], "link": link, "active": True, "createdAt": now_iso()}
    if kind == "image":
        img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        img.thumbnail((1280, 1280))
        dest = ADS_DIR / f"{ad_id}.jpg"
        img.save(dest, "JPEG", quality=85, optimize=True, progressive=True)
        ad.update(src=f"library/ads/{dest.name}", w=img.width, h=img.height)
    else:
        dest = ADS_DIR / f"{ad_id}.mp4"
        proc = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-t", "60", "-map", "0:v:0", "-map", "0:a:0?",
                               "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
                               "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dest)],
                              capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise RuntimeError(f"video: {proc.stderr[-300:]}")
        poster = ADS_DIR / f"{ad_id}.jpg"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", "0.5", "-i", str(dest), "-frames:v", "1", "-q:v", "4", str(poster)],
                       capture_output=True, timeout=60)
        ad.update(src=f"library/ads/{dest.name}", duration=round(_probe_duration(dest), 1))
        if poster.exists():
            ad["poster"] = f"library/ads/{poster.name}"
    ads = load()
    ads.insert(0, ad)
    save(ads)
    return ad


def remove(ad_id: str) -> dict | None:
    ads = load()
    ad = next((a for a in ads if a["id"] == ad_id), None)
    if not ad:
        return None
    for key in ("src", "poster"):
        if ad.get(key):
            (config.ROOT / ad[key]).unlink(missing_ok=True)
    save([a for a in ads if a["id"] != ad_id])
    return ad


def set_active(ad_id: str, active: bool) -> dict | None:
    ads = load()
    ad = next((a for a in ads if a["id"] == ad_id), None)
    if ad:
        ad["active"] = active
        save(ads)
    return ad


def stats() -> dict[str, dict] | None:
    """{ad id: {event: {"n": views, "people": unique listeners, "today": people today}}} from the relay."""
    if not config.RELAY_URL or not config.TOKEN:
        return None
    key = hashlib.sha256(f"cavi-stats:{config.TOKEN}".encode()).hexdigest()
    try:
        resp = requests.get(f"{config.RELAY_URL}/ad-stats", headers={"X-Key": key}, timeout=20)
        data = resp.json() if resp.ok else None
    except (requests.RequestException, ValueError):
        return None
    if not data:
        return None
    out: dict[str, dict] = {}
    for row in data.get("all", []):
        out.setdefault(row["ad"], {})[row["ev"]] = {"n": row["n"], "people": row["people"], "today": 0}
    for row in data.get("today", []):
        out.setdefault(row["ad"], {}).setdefault(row["ev"], {"n": 0, "people": 0, "today": 0})["today"] = row["people"]
    return out
