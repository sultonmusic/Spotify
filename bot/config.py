"""Runtime configuration, read from environment variables (GitHub secrets / variables)."""
from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY_DIR = ROOT / "library"
AUDIO_DIR = LIBRARY_DIR / "audio"
COVERS_DIR = LIBRARY_DIR / "covers"
LYRICS_DIR = LIBRARY_DIR / "lyrics"
ARTISTS_DIR = LIBRARY_DIR / "artists"
SONGS_FILE = LIBRARY_DIR / "songs.json"
STATE_FILE = ROOT / "bot" / "state.json"


def env(name: str, default: str = "") -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def env_bool(name: str, default: bool) -> bool:
    value = env(name)
    if not value:
        return default
    return value.lower() not in ("0", "false", "no", "off")


def env_int(name: str, default: int) -> int:
    try:
        return int(env(name, str(default)))
    except ValueError:
        return default


TOKEN = env("TELEGRAM_BOT_TOKEN")
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY")
AI_MODEL = env("AI_MODEL", "claude-opus-5-5")
AI_WEB_SEARCH = env_bool("AI_WEB_SEARCH", True)
SHAZAM_ENABLED = env_bool("SHAZAM", True)
LYRICS_ENABLED = env_bool("LYRICS", True)

# Who may add songs. OWNER_IDS env overrides this default owner list.
OWNER_IDS = {int(x) for x in re.split(r"[ ,\s]+", env("OWNER_IDS", "8988775229")) if x.isdigit()}
PUBLIC_UPLOADS = env_bool("PUBLIC_UPLOADS", False)

# How long a run keeps listening for new messages (seconds) and hard cap on a run.
LISTEN_SECONDS = env_int("LISTEN_SECONDS", 120)
MAX_RUNTIME_SECONDS = env_int("MAX_RUNTIME_SECONDS", 600)

# Where audio lives: "pages" (inside the site), "release" (GitHub Release assets)
# or "auto" (pages until PAGES_AUDIO_LIMIT_MB is reached, then release).
AUDIO_STORAGE = env("AUDIO_STORAGE", "auto").lower()
PAGES_AUDIO_LIMIT_MB = env_int("PAGES_AUDIO_LIMIT_MB", 700)
RELEASE_TAG = env("RELEASE_TAG", "audio-library")

GITHUB_REPOSITORY = env("GITHUB_REPOSITORY")
GITHUB_TOKEN = env("GITHUB_TOKEN")
DISPATCH_TOKEN = env("DISPATCH_TOKEN")
APP_NAME = env("APP_NAME", "Cavi Music")

TELEGRAM_MAX_DOWNLOAD = 20 * 1024 * 1024  # Bot API getFile limit


def site_url() -> str:
    explicit = env("SITE_URL")
    if explicit:
        return explicit.rstrip("/") + "/"
    if "/" not in GITHUB_REPOSITORY:
        return ""
    owner, repo = GITHUB_REPOSITORY.split("/", 1)
    owner = owner.lower()
    if repo.lower() == f"{owner}.github.io":
        return f"https://{owner}.github.io/"
    return f"https://{owner}.github.io/{repo}/"


SITE_URL = site_url()

# Cloudflare Worker (relay/): wakes the bot and keeps ad statistics for /ads.
RELAY_URL = env("RELAY_URL", "https://cavi-music-relay.sales-infarmatik-tj.workers.dev").rstrip("/")

# Optional (https://my.telegram.org → API development tools): lets the bot download files up to 100 MB.
API_ID = env("TELEGRAM_API_ID", "")
API_HASH = env("TELEGRAM_API_HASH", "")

# Full-length songs from authorised sources (bot/youtube.py, bot/acquire.py).
# YouTube Data API v3 key (Google Cloud console) — finds and verifies the official upload.
YOUTUBE_API_KEY = env("YOUTUBE_API_KEY")
# Channel ids (UC…) whose videos the owner holds the rights to / has written permission to use.
YT_AUTHORIZED_CHANNELS = env("YT_AUTHORIZED_CHANNELS")
# Creative Commons (CC BY) videos may be reused under their licence (with attribution).
YT_ALLOW_CREATIVE_COMMONS = env_bool("YT_ALLOW_CREATIVE_COMMONS", True)
# Jamendo API client id (devportal.jamendo.com) — full tracks whose artists allowed downloads.
JAMENDO_CLIENT_ID = env("JAMENDO_CLIENT_ID")
