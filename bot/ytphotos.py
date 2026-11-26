"""Artist photos from YouTube Music (no key needed): the official artist channel's picture, large size."""
from __future__ import annotations

import re

from .textutil import norm


def artist_photo(name: str) -> dict | None:
    """{name, url, channel} for the YouTube Music artist whose name matches exactly, else None."""
    if not name:
        return None
    try:
        from ytmusicapi import YTMusic

        found = YTMusic().search(name, filter="artists", limit=5)
    except Exception as exc:
        print(f"[ytphotos] search failed for {name!r}: {exc}")
        return None
    want = norm(name)
    for item in found:
        if norm(item.get("artist") or "") != want or not item.get("thumbnails"):
            continue
        url = item["thumbnails"][-1]["url"]
        # thumbnails come small ("=w120-h120-…"): ask the same image at 1000×1000
        url = re.sub(r"=w\d+-h\d+", "=w1000-h1000", url) if re.search(r"=w\d+-h\d+", url) else url + "=w1000-h1000"
        return {"name": item.get("artist"), "url": url, "channel": item.get("browseId")}
    return None
