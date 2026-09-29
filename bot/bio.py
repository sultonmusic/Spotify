"""Who the artist is: a short bio from Wikipedia in the site languages (uz, ru, en).

The article is accepted only when its title matches the artist and it describes a
musician (singer, band, rapper…), so namesakes don't end up on an artist's page.
Missing languages are filled from Wikidata's links, then translated.
"""
from __future__ import annotations

import re
import time
from urllib.parse import quote

import requests

from .textutil import phon, similarity

LANGS = ("uz", "ru", "en")
_session = requests.Session()
# Wikimedia asks API clients to identify themselves with a way to reach the operator.
_session.headers.update({"User-Agent": "CaviMusic/1.0 (https://github.com/sultonmusic/Spotify; personal music station)"})


class RateLimited(Exception):
    """Wikipedia said 'too many requests': stop for this run and try again later."""

_MUSIC = re.compile(
    r"singer|musician|rapper|\bband\b|songwriter|composer|\bdj\b|record producer|vocalist|\bmusical group\b|\bduo\b|"
    r"музыкант|певец|певица|рэпер|группа|композитор|исполнител|диджей|вокалист|дуэт|"
    r"xonanda|qo.shiqchi|hofiz|bastakor|guruh|musiqachi|reper|ijrochi|san.atkor", re.I)
_PAREN = re.compile(r"\s*\([^)]*\)\s*$")


def _get(url: str, params: dict | None = None) -> dict | None:
    time.sleep(0.3)
    try:
        resp = _session.get(url, params=params, timeout=15)
    except requests.RequestException:
        return None
    if resp.status_code == 429:
        raise RateLimited()
    try:
        return resp.json() if resp.ok else None
    except ValueError:
        return None


def _summary(lang: str, title: str) -> dict | None:
    data = _get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'), safe='')}",
                {"redirect": "true"})
    return data if data and data.get("type") == "standard" and data.get("extract") else None


def _search(lang: str, query: str) -> list[str]:
    data = _get(f"https://{lang}.wikipedia.org/w/api.php",
                {"action": "query", "list": "search", "srsearch": query, "srlimit": 4, "format": "json"}) or {}
    return [x["title"] for x in (data.get("query") or {}).get("search", [])]


def _same_name(title: str, names: list[str]) -> bool:
    base = _PAREN.sub("", title)
    return any(phon(base) == phon(n) or similarity(base, n) >= 0.85 for n in names)


def _is_music(s: dict) -> bool:
    return bool(_MUSIC.search(f"{s.get('description', '')} {s.get('extract', '')[:400]}"))


def _short(text: str, limit: int = 600) -> str:
    """First sentences of the intro, up to ~limit characters."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[:end + 1] if end > 120 else cut.rstrip() + "…"


def _sitelinks(qid: str) -> dict[str, str]:
    data = _get("https://www.wikidata.org/w/api.php", {
        "action": "wbgetentities", "ids": qid, "props": "sitelinks", "format": "json",
        "sitefilter": "|".join(f"{l}wiki" for l in LANGS)}) or {}
    links = ((data.get("entities") or {}).get(qid) or {}).get("sitelinks") or {}
    return {k[:-4]: v["title"] for k, v in links.items() if k.endswith("wiki")}


def find(name: str, aliases: list[str] | None = None) -> dict | None:
    """{"bio": {lang: text}, "desc": {lang: short description}, "wiki": {lang: url}} or None.

    Raises RateLimited when Wikipedia asks to slow down (the caller retries on a later run)."""
    names = [name, *(aliases or [])]
    first = None
    for lang, hint in (("en", "singer"), ("ru", "певец"), ("uz", "xonanda")):
        tried: set[str] = set()

        def titles():
            yield name  # the exact title first; search only when that isn't the artist
            yield from _search(lang, f"{name} {hint}")

        for title in titles():
            if title in tried or not _same_name(title, names):
                continue
            tried.add(title)
            s = _summary(lang, title)
            if s and _is_music(s):
                first = (lang, s)
                break
        if first:
            break
    if not first:
        return None
    lang, s = first
    pages = {lang: s}
    try:
        for other, title in (_sitelinks(s["wikibase_item"]) if s.get("wikibase_item") else {}).items():
            if other not in pages:
                page = _summary(other, title)
                if page:
                    pages[other] = page
    except RateLimited:
        pass  # keep what we have; the other languages get translated below
    out = {
        "bio": {l: _short(p["extract"]) for l, p in pages.items()},
        "desc": {l: p["description"] for l, p in pages.items() if p.get("description")},
        "wiki": {l: (p.get("content_urls") or {}).get("desktop", {}).get("page") for l, p in pages.items()},
    }
    missing = [l for l in LANGS if l not in out["bio"]]
    if missing:
        source = "en" if "en" in out["bio"] else next(iter(out["bio"]))
        from .translate import translate_lines
        sentences = re.split(r"(?<=[.!?])\s+", out["bio"][source])
        for target, lines in translate_lines(sentences, source).items():
            if target in missing and all(lines):
                out["bio"][target] = " ".join(lines)
                out.setdefault("translated", []).append(target)
    out["wiki"] = {k: v for k, v in out["wiki"].items() if v}
    return out
