"""Artist profiles: one profile per real artist, linked by catalogue ids, with an official "verified" badge.

A profile is created the first time an artist appears. Later songs by the same
artist (even spelled differently: "Shakhzoda" / "Shahzoda") are attached to the
same profile, matched by Deezer / Apple Music artist id first, then by name.

An artist is *verified* when an official catalogue (Deezer or Apple Music) has
an artist page for them and one of our songs is on it.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from . import bio, lookup
from .textutil import phon, similarity, split_artists

RECHECK_DAYS = 30
BIO_RECHECK_DAYS = 60


def _key(name: str) -> str:
    """Spelling-insensitive key: Shakhzoda / Shahzoda / Шахзода -> 'shahzoda'."""
    return phon(name).replace(" ", "")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Artists:
    def __init__(self, lib) -> None:
        self.lib = lib  # Library: lib.artists is the {canonical name: profile} dict stored in songs.json

    @property
    def profiles(self) -> dict[str, dict[str, Any]]:
        return self.lib.artists

    # ------------------------------------------------------------------ matching
    def find(self, name: str, deezer_id: int | None = None, itunes_id: int | None = None) -> str | None:
        for canon, p in self.profiles.items():
            if (deezer_id and p.get("deezerId") == deezer_id) or (itunes_id and p.get("itunesId") == itunes_id):
                return canon
        key = _key(name)
        for canon, p in self.profiles.items():
            if any(_key(x) == key for x in [canon, *p.get("aliases", [])]):
                return canon
        if len(key) >= 6:
            for canon in self.profiles:
                if similarity(_key(canon), key) >= 0.92:
                    return canon
        return None

    def resolve(self, name: str, info: dict | None = None) -> str:
        """Canonical profile name for `name`, creating/updating the profile. info: catalogue facts."""
        info = info or {}
        canon = self.find(name, info.get("deezerId"), info.get("itunesId"))
        if canon is None:
            canon = name.strip()
            self.profiles[canon] = {"aliases": [], "verified": False}
            self.lib.dirty = True
        p = self.profiles[canon]
        if name != canon and name not in p.setdefault("aliases", []):
            p["aliases"].append(name)
            self.lib.dirty = True
        for field in ("deezerId", "itunesId", "deezer", "apple", "fans"):
            if info.get(field) and not p.get(field):
                p[field] = info[field]
                self.lib.dirty = True
        if info.get("picture") and not p.get("image"):
            self.lib.set_artist_image(canon, info["picture"])
        if info.get("verified") and not p.get("verified") and not p.get("manual"):
            p["verified"] = True
            p["checked"] = p["verifiedAt"] = _now()
            self.lib.dirty = True
        if p.get("deezerId") and "fans" not in p:
            official = lookup.deezer_artist(p["deezerId"])
            if official:
                p["fans"] = official.get("fans") or 0
                if official.get("albums"):
                    p["albums"] = official["albums"]
                p.setdefault("deezer", official.get("link"))
                if official.get("picture") and not p.get("image"):
                    self.lib.set_artist_image(canon, official["picture"])
        return canon

    def resolve_song(self, artists: list[str], facts: dict[str, dict]) -> list[str]:
        """Maps every performer of a song to its profile. facts: {name: catalogue info} (fuzzy keys ok)."""
        out: list[str] = []
        for name in artists:
            info = next((v for k, v in facts.items() if _key(k) == _key(name)), None)
            canon = self.resolve(name, info)
            if canon not in out:
                out.append(canon)
        return out

    # ------------------------------------------------------------------ admin tools
    def merge(self, source: str, target: str) -> bool:
        """Moves every song of `source` to `target` and keeps the old spelling as an alias."""
        src = source if source in self.profiles else self.find(source)
        dst = target if target in self.profiles else (self.find(target) or target)
        if not src or src == dst:
            return False
        return self._merge(src, dst)

    def _merge(self, src: str, dst: str) -> bool:
        sp = self.profiles.pop(src)
        dp = self.profiles.setdefault(dst, {"aliases": [], "verified": False})
        for alias in [src, *sp.get("aliases", [])]:
            if alias != dst and alias not in dp.setdefault("aliases", []):
                dp["aliases"].append(alias)
        for field, value in sp.items():
            if field != "aliases" and value and not dp.get(field):
                dp[field] = value
        for s in self.lib.songs:
            if src in s.get("artists", []):
                s["artists"] = list(dict.fromkeys(dst if a == src else a for a in s["artists"]))
                s["artist"] = ", ".join(s["artists"])
        self.lib.dirty = True
        return True

    def set_verified(self, name: str, value: bool) -> str | None:
        canon = self.find(name)
        if canon:
            self.profiles[canon]["verified"] = value
            self.profiles[canon]["manual"] = True
            if value:
                self.profiles[canon]["verifiedAt"] = _now()
            else:
                self.profiles[canon].pop("verifiedAt", None)
            self.lib.dirty = True
        return canon

    # ------------------------------------------------------------------ maintenance
    def sync_with_songs(self) -> None:
        """Every performer of every song belongs to a profile; spelling variants join the same one."""
        groups: dict[str, list[str]] = {}
        for name in self.profiles:
            groups.setdefault(_key(name), []).append(name)
        for names in groups.values():
            if len(names) > 1:
                # keep the profile with the most official info, fold the others into it
                keep = max(names, key=lambda n: (bool(self.profiles[n].get("verified")),
                                                 bool(self.profiles[n].get("deezerId") or self.profiles[n].get("itunesId")),
                                                 sum(n in s.get("artists", []) for s in self.lib.songs)))
                for other in names:
                    if other != keep:
                        self._merge(other, keep)
        for p in self.profiles.values():
            if p.get("verified") and not p.get("verifiedAt"):
                p["verifiedAt"] = p.get("checked") or _now()
                self.lib.dirty = True
        for s in self.lib.songs:
            artists = s.get("artists") or [s.get("artist", "")]
            if all(a in self.profiles for a in artists):
                continue
            canon = []
            for a in artists:
                c = a if a in self.profiles else self.resolve(a)
                if c not in canon:
                    canon.append(c)
            if canon != artists:
                s["artists"], s["artist"] = canon, ", ".join(canon)
                self.lib.dirty = True

    def backfill(self, budget: int = 8) -> None:
        """Looks up unverified artists on Deezer: verified if a song of ours is on their official page."""
        now = datetime.now(timezone.utc)
        for name, p in list(self.profiles.items()):
            if budget <= 0:
                break
            if p.get("verified") or p.get("manual"):
                continue
            checked = p.get("checked")
            if checked and now - datetime.fromisoformat(checked.replace("Z", "+00:00")) < timedelta(days=RECHECK_DAYS):
                continue
            budget -= 1
            p["checked"] = _now()
            self.lib.dirty = True
            mine = [s for s in self.lib.songs if name in s.get("artists", [])]
            # 1) Deezer: the artist's official page lists one of our songs
            found = lookup.deezer_artist(p["deezerId"]) if p.get("deezerId") else lookup.deezer_find_artist(name)
            if found:
                titles = lookup.deezer_top_titles(found["id"])
                if any(similarity(s["title"], t) >= 0.85 for s in mine for t in titles):
                    p.update(verified=True, verifiedAt=_now(), deezerId=found["id"], deezer=found.get("link"),
                             fans=found.get("fans"))
                    if found.get("albums"):
                        p["albums"] = found["albums"]
                    if found.get("picture") and not p.get("image"):
                        self.lib.set_artist_image(name, found["picture"])
                    continue
            # 2) Apple Music: one of our songs is released under this artist
            for s in mine[:2]:
                hit = lookup.itunes(s["title"], name, s.get("duration") or 0)
                if hit and hit["score"] >= 0.85 and hit.get("artist_id") and similarity(
                        split_artists(hit["artist"])[0], name) >= 0.85:
                    p.update(verified=True, verifiedAt=_now(), itunesId=hit["artist_id"], apple=hit.get("artist_url"))
                    break

    def backfill_bios(self, budget: int = 2) -> None:
        """Who the artist is (Wikipedia, uz/ru/en) for the artist info sheet. Verified artists first."""
        now = datetime.now(timezone.utc)
        order = sorted(self.profiles.items(), key=lambda kv: not kv[1].get("verified"))
        for name, p in order:
            if budget <= 0:
                break
            if p.get("bio"):
                continue
            checked = p.get("bioChecked")
            if checked and now - datetime.fromisoformat(checked.replace("Z", "+00:00")) < timedelta(days=BIO_RECHECK_DAYS):
                continue
            budget -= 1
            try:
                found = bio.find(name, p.get("aliases"))
            except bio.RateLimited:
                print("[bio] Wikipedia rate limit, later")
                return
            except Exception as exc:  # never break a bot run over a bio
                print(f"[bio] {name}: {exc}")
                found = None
            p["bioChecked"] = _now()
            if found:
                p["bio"], p["wiki"] = found["bio"], found["wiki"]
                if found.get("desc"):
                    p["desc"] = found["desc"]
                if found.get("translated"):
                    p["bioTr"] = found["translated"]
            self.lib.dirty = True
