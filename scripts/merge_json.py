#!/usr/bin/env python3
"""Git merge driver for library/songs.json and library/ads.json.

Two bot runs can each commit the library (e.g. one attaches a video while another adds songs). A line-based
merge of the JSON then conflicts and the run's work is lost, so these files are merged item by item instead:
songs/ads by id, artist profiles by name. An item changed on one side only takes that change; changed on both
sides, the newer one (updatedAt/addedAt) wins; deleted on one side and untouched on the other, it stays deleted.

Usage (set by the workflow): git config merge.library.driver "python3 scripts/merge_json.py %O %A %B"
Writes the result into %A and exits 0; exits 1 (a normal conflict) if a file can't be read as JSON.
"""
from __future__ import annotations

import json
import sys


def load(path: str):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def stamp(item: dict) -> str:
    return str(item.get("updatedAt") or item.get("addedAt") or item.get("createdAt") or "")


def three_way(base: dict, ours: dict, theirs: dict, newest: bool) -> dict:
    """Merge two {key: item} maps against their common base."""
    out = {}
    for key in dict.fromkeys([*ours, *theirs]):
        o, t, b = ours.get(key), theirs.get(key), base.get(key)
        if o is None or t is None:
            present = o if t is None else t
            if key in base and b == present:
                continue  # deleted on one side, unchanged on the other
            out[key] = present
        elif o == t or b == t:
            out[key] = o
        elif b == o:
            out[key] = t
        elif newest:
            out[key] = o if stamp(o) >= stamp(t) else t
        else:
            out[key] = {**t, **o} if isinstance(o, dict) and isinstance(t, dict) else o
    return out


def main() -> int:
    base_path, ours_path, theirs_path = sys.argv[1:4]
    base, ours, theirs = load(base_path) or {}, load(ours_path), load(theirs_path)
    if not isinstance(ours, dict) or not isinstance(theirs, dict):
        return 1
    result = {**theirs, **ours}
    for list_key in ("songs", "ads"):
        if list_key in ours or list_key in theirs:
            by_id = lambda d: {x["id"]: x for x in d.get(list_key, []) if isinstance(x, dict) and "id" in x}  # noqa: E731
            merged = three_way(by_id(base), by_id(ours), by_id(theirs), newest=True)
            order = "addedAt" if list_key == "songs" else "createdAt"
            result[list_key] = sorted(merged.values(), key=lambda x: str(x.get(order) or ""), reverse=True)
    if "artists" in ours or "artists" in theirs:
        result["artists"] = three_way(base.get("artists") or {}, ours.get("artists") or {}, theirs.get("artists") or {},
                                      newest=False)
    if "site" in ours or "site" in theirs:
        site = {**(theirs.get("site") or {}), **(ours.get("site") or {})}
        admins = [*(theirs.get("site") or {}).get("admins", []), *(ours.get("site") or {}).get("admins", [])]
        if admins:
            site["admins"] = list(dict.fromkeys(admins))
        result["site"] = site
    stamps = [x for x in (ours.get("updatedAt"), theirs.get("updatedAt")) if x]
    if stamps:
        result["updatedAt"] = max(stamps)
    if "songs" in result and "count" in result:
        result["count"] = len(result["songs"])
    with open(ours_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
