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

# Who may add songs. Empty -> the first person who writes to the bot becomes the owner.
OWNER_IDS = {int(x) for x in re.split(r"[,\s]+", env("OWNER_IDS")) if x.isdigit()}
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
