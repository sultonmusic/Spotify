"""Artist photos from Spotify (Web API, client-credentials). Needs SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.

Spotify's terms don't allow copying their images, so the site shows the photo straight from Spotify's
image server (i.scdn.co); only its main colour is computed here for the artist page background.
"""
from __future__ import annotations

import base64
import os
import tempfile
import time
from pathlib import Path

import requests

from .textutil import norm

_token: dict = {"value": "", "until": 0.0}


def enabled() -> bool:
    return bool(os.environ.get("SPOTIFY_CLIENT_ID") and os.environ.get("SPOTIFY_CLIENT_SECRET"))


def _access_token() -> str:
    if _token["value"] and time.time() < _token["until"] - 60:
        return _token["value"]
    pair = f"{os.environ['SPOTIFY_CLIENT_ID']}:{os.environ['SPOTIFY_CLIENT_SECRET']}".encode()
    resp = requests.post("https://accounts.spotify.com/api/token", data={"grant_type": "client_credentials"},
                         headers={"Authorization": "Basic " + base64.b64encode(pair).decode()}, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    _token.update(value=data["access_token"], until=time.time() + int(data.get("expires_in", 3600)))
    return _token["value"]


def artist(name: str) -> dict | None:
    """The Spotify artist whose name matches exactly (most followed if several): {id, name, image, url}."""
    if not enabled() or not name:
        return None
    try:
        resp = requests.get("https://api.spotify.com/v1/search", params={"q": name, "type": "artist", "limit": 10},
                            headers={"Authorization": f"Bearer {_access_token()}"}, timeout=20)
        if resp.status_code == 429:
            print("[spotify] rate limited")
            return None
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"[spotify] search failed: {exc}")
        return None
    want = norm(name)
    hits = [a for a in (resp.json().get("artists") or {}).get("items") or []
            if norm(a.get("name") or "") == want and a.get("images")]
    if not hits:
        return None
    best = max(hits, key=lambda a: (a.get("followers") or {}).get("total") or 0)
    image = max(best["images"], key=lambda i: (i.get("width") or 0))["url"]
    return {"id": best["id"], "name": best["name"], "image": image,
            "url": (best.get("external_urls") or {}).get("spotify")}


def main_color(url: str) -> str | None:
    """Dominant colour of the photo (the file itself is not kept)."""
    from .covers import save_cover
    from .lookup import download_image

    data = download_image(url)
    if not data:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        return save_cover(data, Path(tmp) / "a.jpg")
