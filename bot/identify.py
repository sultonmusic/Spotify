"""Turns a song (an uploaded file, or a catalogue entry picked by name) into a fully tagged record."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from . import ai, audio, config, lookup
from .taxonomy import GENRE_PROFILE, LANGUAGES, MOODS, canonical_genre, guess_language, guess_moods
from .textutil import clean, similarity, split_artist_title, split_artists, strip_feat


@dataclass
class Clues:
    tg_performer: str = ""
    tg_title: str = ""
    file_name: str = ""
    caption: str = ""
    thumb: Path | None = None


@dataclass
class Result:
    meta: dict[str, Any]
    cover: bytes | None = None
    lyrics: dict | None = None
    sources: list[str] = field(default_factory=list)
    # Catalogue facts per performer name: deezerId, itunesId, picture, links, verified
    artist_facts: dict[str, dict] = field(default_factory=dict)


def _hint(clues: Clues, tags: dict[str, str]) -> tuple[str, str]:
    """Best guess of (artist, title) from what the uploader gave us."""
    candidates: list[tuple[str, str]] = []
    for performer, raw_title in ((clues.tg_performer, clues.tg_title), (tags.get("artist", ""), tags.get("title", ""))):
        if not raw_title:
            continue
        a, t = clean(performer), clean(raw_title)
        split_a, split_t = split_artist_title(raw_title)
        if not a or (split_a and similarity(split_a, a) >= 0.8):
            # "Artist - Title" stuffed into the title field
            a, t = (a or split_a), (split_t if split_a else t)
        candidates.append((a, t))
    if clues.file_name:
        stem = re.sub(r"\.[A-Za-z0-9]{2,4}$", "", clues.file_name)
        candidates.append(split_artist_title(stem))
    if clues.caption:
        first_line = clues.caption.strip().splitlines()[0]
        candidates.append(split_artist_title(first_line))
    for a, t in candidates:
        if a and t:
            return a, t
    for a, t in candidates:
        if t:
            return a, t
    return "", ""


def _matches(cand: dict | None, title: str, artist: str) -> bool:
    return bool(cand) and lookup.same_song(title, artist, cand.get("title", ""), cand.get("artist", ""))


def _clip(value: Any, lo: float = 0.0, hi: float = 1.0, default: float = 0.5) -> float:
    try:
        return round(min(hi, max(lo, float(value))), 2)
    except (TypeError, ValueError):
        return default


def _descriptions(value: Any) -> dict | None:
    if isinstance(value, dict):
        out = {k: str(v).strip()[:240] for k, v in value.items() if k in ("uz", "ru", "en") and str(v).strip()}
        return out or None
    if isinstance(value, str) and value.strip():
        return {"uz": value.strip()[:240]}
    return None


def identify(src: Path | None, info: audio.AudioInfo, clues: Clues, workdir: Path,
             progress: Callable[[str], None] = lambda _: None, known: dict | None = None) -> Result:
    """src=None + known=catalogue entry: a song added by name (no audio file)."""
    tags = audio.read_tags(src, info) if src else {}
    hint_artist, hint_title = (known["artist"], known["title"]) if known else _hint(clues, tags)
    sources: list[str] = []

    # `authority` = the most trustworthy identification: the owner's pick, or Shazam's fingerprint.
    authority = None
    if known:
        authority = known
    elif src and config.SHAZAM_ENABLED and info.duration >= 8:
        progress("🔎 Qo'shiq ovozidan aniqlanmoqda (Shazam)…")
        clip = audio.excerpt(src, workdir / "clip.wav", info)
        if clip:
            authority = lookup.shazam(clip)
            if authority:
                sources.append("shazam")

    q_title, q_artist = (authority["title"], authority["artist"]) if authority else (hint_title, hint_artist)
    q_title_nofeat, _ = strip_feat(q_title)
    main_q = split_artists(q_artist)[0] if q_artist else ""
    progress("🌐 Katalogdan ma'lumot qidirilmoqda…")
    itunes = lookup.itunes(q_title_nofeat, main_q, info.duration) if q_title else None
    deezer = lookup.deezer(q_title_nofeat, main_q, info.duration) if q_title else None

    # Best non-AI guess (also used to fetch lyrics before the AI step).
    if authority:
        title, artist = authority["title"], authority["artist"]
    elif itunes and itunes["score"] >= 0.82:
        title, artist = itunes["title"], itunes["artist"]
    elif deezer and deezer["score"] >= 0.82:
        title, artist = deezer["title"], deezer["artist"]
    else:
        title, artist = hint_title, hint_artist
    title = title or "Noma'lum qo'shiq"

    lyr = lookup.lyrics(strip_feat(title)[0], split_artists(artist)[0] if artist else "", "", info.duration) \
        if config.LYRICS_ENABLED else None

    decision = None
    if ai.enabled():
        progress("🤖 AI qo'shiqni tahlil qilmoqda…")
        evidence = {
            "duration_seconds": round(info.duration),
            "chosen": {k: known.get(k) for k in ("title", "artist", "album", "year", "genre")} if known else None,
            "telegram": None if known else {"performer": clues.tg_performer, "title": clues.tg_title,
                                            "file_name": clues.file_name, "caption": clues.caption[:300]},
            "file_tags": tags or None,
            "filename_guess": None if known else {"artist": hint_artist, "title": hint_title},
            "shazam": None if known else authority,
            "itunes": itunes,
            "deezer": {k: v for k, v in (deezer or {}).items() if k not in ("artist_picture", "contributors")} or None,
            "lyrics_excerpt": ((lyr or {}).get("plain") or "")[:700] or None,
        }
        decision = ai.tag(evidence)
        if decision:
            sources.append("ai")

    meta: dict[str, Any] = {}
    if decision:
        artists = [a.strip() for a in decision.get("artists") or [] if a and a.strip()] or split_artists(artist)
        meta.update(
            title=clean(decision["title"]) or title,
            artists=artists,
            album=decision.get("album") or None,
            year=decision.get("year") or None,
            genre=decision.get("genre") if decision.get("genre") in GENRE_PROFILE else "Other",
            subgenre=decision.get("subgenre") or None,
            moods=[m for m in decision.get("moods") or [] if m in MOODS][:3],
            language=decision.get("language") if decision.get("language") in LANGUAGES else "other",
            energy=_clip(decision.get("energy")),
            danceability=_clip(decision.get("danceability")),
            tags=[str(t).lower().strip()[:32] for t in decision.get("tags") or [] if str(t).strip()][:8],
            description=_descriptions(decision.get("description")),
            confidence=_clip(decision.get("confidence"), default=0.7),
        )
    else:
        base_title, feats = strip_feat(title)
        artists = split_artists(artist) + [f for f in feats if f not in split_artists(artist)]
        if deezer and deezer.get("artists") and _matches(deezer, base_title, artist):
            artists = list(dict.fromkeys(artists + [a for a in deezer["artists"] if a not in artists]))
        cat = next((c for c in (itunes, deezer) if _matches(c, base_title, artist)), None)
        raw_genre = ((authority or {}).get("genre")
                     or (_matches(itunes, base_title, artist) and itunes.get("genre"))
                     or (_matches(deezer, base_title, artist) and deezer.get("genre"))
                     or tags.get("genre") or "")
        genre = canonical_genre(raw_genre)
        lyrics_text = (lyr or {}).get("plain") or ""
        bpm = (deezer or {}).get("bpm") if _matches(deezer, base_title, artist) else None
        moods, energy = guess_moods(genre, bpm, lyrics_text)
        meta.update(
            title=base_title,
            artists=artists or [],
            album=(authority or {}).get("album") or (cat or {}).get("album") or tags.get("album") or None,
            year=(authority or {}).get("year") or (cat or {}).get("year") or None,
            genre=genre,
            subgenre=raw_genre if raw_genre and raw_genre != genre else None,
            moods=list(moods),
            language=guess_language(base_title, lyrics_text[:1500], artist=artist),
            energy=energy,
            danceability=round(min(1.0, energy + 0.05), 2),
            tags=[],
            description=None,
            confidence=0.95 if authority else 0.8 if cat else 0.4,
        )
    if not meta["artists"]:
        meta["artists"] = ["Noma'lum ijrochi"]
    meta["artist"] = ", ".join(meta["artists"])

    # Catalogue extras that match the final decision
    final_title, main_artist = meta["title"], meta["artists"][0]
    it_ok, dz_ok = _matches(itunes, final_title, main_artist), _matches(deezer, final_title, main_artist)
    au_ok = _matches(authority, final_title, main_artist)
    for flag, name in ((it_ok, "itunes"), (dz_ok, "deezer")):
        if flag:
            sources.append(name)
    if dz_ok and deezer.get("bpm"):
        meta["bpm"] = deezer["bpm"]
    meta["explicit"] = bool((it_ok and itunes.get("explicit")) or (dz_ok and deezer.get("explicit")))
    if not meta.get("year"):
        meta["year"] = (itunes or {}).get("year") if it_ok else (deezer or {}).get("year") if dz_ok else None

    # Lyrics for the final title (refetch if the AI changed the song)
    if config.LYRICS_ENABLED and (similarity(final_title, title) < 0.85 or not lyr):
        lyr = lookup.lyrics(final_title, main_artist, meta.get("album") or "", info.duration) or lyr

    # Cover art: first usable candidate wins
    progress("🎨 Muqova tayyorlanmoqda…")
    cover: bytes | None = None
    urls = [(au_ok and authority.get("cover")), (it_ok and itunes.get("cover")), (dz_ok and deezer.get("cover"))]
    for url in urls:
        if url and not cover:
            cover = lookup.download_image(url)
    if not cover and src:
        pic = audio.extract_picture(src, workdir / "embedded.png", info)
        if pic:
            cover = pic.read_bytes()
    if not cover and clues.thumb and clues.thumb.exists():
        cover = clues.thumb.read_bytes()

    return Result(meta=meta, cover=cover, lyrics=lyr, sources=sorted(set(sources)),
                  artist_facts=_artist_facts(meta["artists"], itunes if it_ok else None, deezer if dz_ok else None))


def _artist_facts(artists: list[str], itunes: dict | None, deezer: dict | None) -> dict[str, dict]:
    """Official catalogue ids/pictures for the performers. Found in a matching catalogue entry => verified."""
    facts: dict[str, dict] = {}
    main = artists[0] if artists else ""
    if itunes and itunes.get("artist_id") and similarity(split_artists(itunes["artist"])[0], main) >= 0.85:
        facts.setdefault(main, {}).update(itunesId=itunes["artist_id"], apple=itunes.get("artist_url"), verified=True)
    if deezer:
        people = deezer.get("contributors") or [
            {"name": deezer.get("artist"), "id": deezer.get("artist_id"), "picture": deezer.get("artist_picture")}]
        for c in people:
            name = next((a for a in artists if similarity(a, c.get("name") or "") >= 0.85), None)
            if name and c.get("id"):
                facts.setdefault(name, {}).update(
                    deezerId=c["id"], picture=c.get("picture"), deezer=f"https://www.deezer.com/artist/{c['id']}",
                    verified=True)
    return facts


def lyrics_payload(lyr: dict | None) -> tuple[str | None, dict | None]:
    """(kind, json payload) for library/lyrics/<id>.json"""
    if not lyr or lyr.get("instrumental"):
        return None, None
    synced = lookup.parse_lrc(lyr.get("synced") or "")
    if synced:
        return "synced", {"synced": synced, "plain": lyr.get("plain")}
    if lyr.get("plain"):
        return "plain", {"synced": None, "plain": lyr["plain"]}
    return None, None
