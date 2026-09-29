"""Line-by-line lyrics translation into the site languages (Uzbek, Russian, English).

Providers, best first: Claude (when ANTHROPIC_API_KEY is set), Google's free web
translator, MyMemory. Each lyric line keeps its position, so the site can show the
translation right under the original line of the synced lyrics.
"""
from __future__ import annotations

import html
import json
import time
from typing import Any

import requests

from . import ai, config

SITE_LANGS = ("uz", "ru", "en")
_session = requests.Session()
_session.headers.update({"User-Agent": "Mozilla/5.0 (CaviMusic lyrics)"})


def _chunks(lines: list[str], limit: int = 450) -> list[list[str]]:
    out, cur, size = [], [], 0
    for line in lines:
        if cur and size + len(line) + 1 > limit:
            out.append(cur)
            cur, size = [], 0
        cur.append(line)
        size += len(line) + 1
    if cur:
        out.append(cur)
    return out


def _google(lines: list[str], source: str, target: str) -> dict[str, str] | None:
    result: dict[str, str] = {}
    for chunk in _chunks(lines, 1500):
        try:
            resp = _session.get("https://translate.googleapis.com/translate_a/single", timeout=15, params={
                "client": "gtx", "sl": source if source in SITE_LANGS else "auto", "tl": target, "dt": "t",
                "q": "\n".join(chunk)})
            data = resp.json()
        except (requests.RequestException, ValueError):
            return None
        text = "".join(seg[0] for seg in data[0] if seg and seg[0])
        parts = [p.strip() for p in text.split("\n")]
        if len(parts) != len(chunk):
            return None
        result.update(zip(chunk, parts))
        time.sleep(0.2)
    return result


def _mymemory(lines: list[str], source: str, target: str) -> dict[str, str] | None:
    if source not in SITE_LANGS + ("tr", "kk", "ky", "tg", "az", "fa", "ar", "hi", "ko", "es", "fr", "de", "it"):
        return None
    result: dict[str, str] = {}
    for chunk in _chunks(lines):
        try:
            data = _session.get("https://api.mymemory.translated.net/get", timeout=20, params={
                "q": "\n".join(chunk), "langpair": f"{source}|{target}"}).json()
        except (requests.RequestException, ValueError):
            return None
        if data.get("quotaFinished") or data.get("responseStatus") not in (200, "200"):
            return None
        parts = [p.strip() for p in html.unescape(data["responseData"]["translatedText"]).split("\n")]
        if len(parts) != len(chunk):
            return None
        result.update(zip(chunk, parts))
        time.sleep(0.3)
    return result


def _claude(lines: list[str], source: str, targets: list[str]) -> dict[str, dict[str, str]] | None:
    try:
        import anthropic
    except ImportError:
        return None
    schema: dict[str, Any] = {
        "type": "object",
        "properties": {t: {"type": "array", "items": {"type": "string"}} for t in targets},
        "required": targets,
        "additionalProperties": False,
    }
    names = {"uz": "Uzbek (Latin script)", "ru": "Russian", "en": "English"}
    prompt = (
        "Translate these song lyric lines. Keep one translation per input line, in the same order, "
        "natural and singable in meaning (not word-for-word). Keep names as they are.\n"
        f"Target languages: {', '.join(f'{t} = {names[t]}' for t in targets)}.\n\n"
        + json.dumps(lines, ensure_ascii=False))
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, max_retries=2, timeout=300)
    try:
        with client.messages.stream(
            model=config.AI_MODEL, max_tokens=32000,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            message = stream.get_final_message()
    except Exception as exc:  # any API/SDK problem -> fall back to the free translators
        print(f"[translate] claude: {exc}")
        return None
    if message.stop_reason == "refusal":
        return None
    text = "".join(b.text for b in message.content if getattr(b, "type", "") == "text")
    try:
        data = json.loads(text)
    except ValueError:
        return None
    out = {}
    for t in targets:
        arr = data.get(t) or []
        if len(arr) == len(lines):
            out[t] = dict(zip(lines, (str(x).strip() for x in arr)))
    return out or None


def translate_lines(lines: list[str], source: str) -> dict[str, list[str]]:
    """{lang: [translation per line]} for every site language except the song's own."""
    targets = [t for t in SITE_LANGS if t != source]
    unique = list(dict.fromkeys(line.strip() for line in lines if line and line.strip()))
    if not unique or source == "instrumental":
        return {}
    by_ai = _claude(unique, source, targets) if ai.enabled() else None
    out: dict[str, list[str]] = {}
    for target in targets:
        mapping = (by_ai or {}).get(target) or _google(unique, source, target) or _mymemory(unique, source, target)
        if mapping:
            out[target] = [mapping.get(line.strip(), "") if line and line.strip() else "" for line in lines]
    return out


def translate_lyrics_file(path, language: str) -> bool:
    """Adds translations to a library/lyrics/<id>.json file. Returns True when something was added."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if data.get("tr"):
        return False
    lines = [l[1] for l in data["synced"]] if data.get("synced") else (data.get("plain") or "").split("\n")
    tr = translate_lines(lines, language)
    data["tr"] = tr or {}
    data["trFor"] = "synced" if data.get("synced") else "plain"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return bool(tr)
