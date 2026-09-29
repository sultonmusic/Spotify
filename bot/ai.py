"""AI tagging with Claude: decides the final title/artist and adds genre, mood, language, tags.

Claude receives every clue we collected (Telegram fields, file tags, filename,
Shazam and catalogue matches) and may use web search for songs the catalogues
don't know (common for Uzbek and other regional music). Output is constrained
to a JSON schema, so the result is always machine readable.
"""
from __future__ import annotations

import json
import re
from typing import Any

from . import config
from .taxonomy import GENRES, LANGUAGES, MOODS

SYSTEM = f"""You are the music librarian of a personal streaming service. For each uploaded audio file you \
receive every clue that was collected and you must decide the song's real metadata.

How to weigh the clues:
- "chosen" (when present) is the exact catalogue entry the station owner picked: treat its title and artist as correct.
- "shazam" comes from an audio fingerprint of the actual sound and is very reliable when present.
- "itunes"/"deezer" are catalogue search results with a match score; a match below ~0.75 may be a different song.
- "file_tags", "telegram" and "filename" are written by whoever shared the file. They often contain junk such as \
channel names (@channel, t.me links, website names), "official video", "premyera", emoji or a wrong artist.
- If the clues disagree or the song is obscure (common for Uzbek, Tajik, Kazakh and other Central Asian music), \
use web search to find who really performs it. Do not invent facts: if you cannot verify something, keep the most \
plausible value from the clues and lower "confidence".

Output rules:
- title: the clean song title. Keep meaningful qualifiers like "Remix", "Live", "Acoustic", "Cover"; drop \
"Official Video", years, channel names and similar junk. Do not put featured artists in the title.
- artists: main performer first, then featured artists. Use the spelling the artist officially uses on streaming \
services (e.g. Uzbek artists usually in Uzbek Latin).
- album: album or single name if known, otherwise null. year: release year if known, otherwise null.
- genre: exactly one of {GENRES}. "Estrada" means Uzbek/Russian/CIS pop-estrada; "Folk" includes traditional, \
maqom and folk-pop; use "Other" only as a last resort. subgenre: a short free-text style (e.g. "Uzbek pop", "trap").
- moods: 1-3 of {MOODS}.
- language: the sung language, one of {LANGUAGES}.
- energy: 0.0 (very calm) to 1.0 (very intense). danceability: 0.0 to 1.0.
- tags: 3-8 short lowercase search tags (styles, themes, occasions, e.g. "wedding", "summer", "workout", "breakup").
- description: one short sentence describing the song for listeners, written three times: "uz" in Uzbek \
(Latin script), "ru" in Russian, "en" in English.
- confidence: 0.0-1.0, how sure you are about title+artists.
"""

_nullable_str = {"anyOf": [{"type": "string"}, {"type": "null"}]}
SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "artists": {"type": "array", "items": {"type": "string"}},
        "album": _nullable_str,
        "year": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
        "genre": {"type": "string", "enum": GENRES},
        "subgenre": _nullable_str,
        "moods": {"type": "array", "items": {"type": "string", "enum": MOODS}},
        "language": {"type": "string", "enum": LANGUAGES},
        "energy": {"type": "number"},
        "danceability": {"type": "number"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "description": {
            "type": "object",
            "properties": {"uz": {"type": "string"}, "ru": {"type": "string"}, "en": {"type": "string"}},
            "required": ["uz", "ru", "en"],
            "additionalProperties": False,
        },
        "confidence": {"type": "number"},
    },
    "required": ["title", "artists", "album", "year", "genre", "subgenre", "moods", "language",
                 "energy", "danceability", "tags", "description", "confidence"],
    "additionalProperties": False,
}


def enabled() -> bool:
    return bool(config.ANTHROPIC_API_KEY)


def _extract_json(text: str) -> dict | None:
    try:
        return json.loads(text)
    except ValueError:
        pass
    match = re.search(r"\{.*\}", text, re.S)
    if match:
        try:
            return json.loads(match.group(0))
        except ValueError:
            return None
    return None


FALLBACK_MODELS = ("claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5")


def _request(client, messages: list, full: bool):
    """full=True: web search + server-side refusal fallback. full=False: the plain request (safe retry)."""
    params: dict[str, Any] = {
        "model": config.AI_MODEL,
        "max_tokens": 16000,
        "system": SYSTEM,
        "messages": messages,
        "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
    }
    if full and config.AI_WEB_SEARCH:
        params["tools"] = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 4}]
    if full and config.AI_MODEL in FALLBACK_MODELS:
        # Server-side fallback: if a safety classifier declines, Anthropic retries on its recommended model.
        return client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params)
    return client.messages.create(**params)


def tag(evidence: dict) -> dict | None:
    """Returns the AI decision (dict matching SCHEMA) or None if AI is off / failed."""
    if not enabled():
        return None
    try:
        import anthropic
    except ImportError:
        print("[ai] anthropic package missing")
        return None

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, max_retries=3, timeout=300)
    prompt = ("Identify this song and return its metadata.\n\nCollected clues (JSON):\n"
              + json.dumps(evidence, ensure_ascii=False, indent=1))
    first: dict = {"role": "user", "content": prompt}

    for full in (True, False):
        messages: list = [first]
        try:
            response = _request(client, messages, full)
            continuations = 0
            while response.stop_reason == "pause_turn" and continuations < 3:
                # Server-side web search loop paused; send the partial turn back so it continues.
                messages = [first, {"role": "assistant", "content": response.content}]
                response = _request(client, messages, full)
                continuations += 1
        except anthropic.BadRequestError as exc:
            print(f"[ai] bad request: {exc}")
            if full:
                continue  # retry once as a plain request (no web search / fallback)
            return None
        except anthropic.APIStatusError as exc:
            print(f"[ai] API error {exc.status_code}: {exc}")
            return None
        except anthropic.APIConnectionError as exc:
            print(f"[ai] connection error: {exc}")
            return None

        if response.stop_reason == "refusal":
            print("[ai] request declined")
            return None
        texts = [b.text for b in response.content if getattr(b, "type", "") == "text"]
        data = _extract_json(texts[-1] if texts else "") or _extract_json("".join(texts))
        if not data or not data.get("title"):
            print(f"[ai] unexpected output (stop_reason={response.stop_reason})")
            return None
        return data
    return None
