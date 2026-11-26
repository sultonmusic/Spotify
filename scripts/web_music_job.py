"""Runs an owner-authorized upload from the website through the existing station pipeline."""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import sys
import tempfile
import time
import traceback
from urllib.parse import urlsplit
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

MAX_BYTES = 20 * 1024 * 1024
JOB_ID_RE = re.compile(r"^[a-f0-9-]{36}$", re.I)


def api_base() -> str:
    return os.environ.get("WEB_MUSIC_API_URL", "https://cavi-music-relay.sales-infarmatik-tj.workers.dev").rstrip("/")


def signed_headers(action: str, job_id: str) -> dict[str, str]:
    secret = os.environ.get("DISPATCH_TOKEN", "")
    if not secret:
        raise RuntimeError("DISPATCH_TOKEN is not configured")
    timestamp = str(int(time.time()))
    payload = f"cavi-web-music\n{action}\n{job_id}\n{timestamp}".encode()
    signature = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return {"X-Music-Timestamp": timestamp, "X-Music-Signature": signature}


def update_status(job_id: str, status: str, message: str = "", result: dict | None = None) -> None:
    body = {"status": status, "message": message[:240]}
    if result is not None:
        body["result"] = result
    response = requests.post(f"{api_base()}/internal/music/jobs/{job_id}/status",
        headers={**signed_headers("status", job_id), "Content-Type": "application/json"},
        json=body, timeout=30)
    response.raise_for_status()


def fetch_upload(job_id: str) -> tuple[bytes, dict]:
    response = requests.get(f"{api_base()}/internal/music/jobs/{job_id}/input",
        headers=signed_headers("input", job_id), timeout=(15, 120))
    response.raise_for_status()
    if len(response.content) > MAX_BYTES or not response.content:
        raise RuntimeError("upload exceeds 20 MB or is empty")
    try:
        meta = json.loads(base64.b64decode(response.headers["X-Music-Meta"]).decode("utf-8"))
    except (KeyError, ValueError, UnicodeDecodeError) as exc:
        raise RuntimeError("upload metadata is invalid") from exc
    if meta.get("kind") not in ("audio", "video", "identify") or not JOB_ID_RE.fullmatch(job_id):
        raise RuntimeError("upload type is invalid")
    if len(response.content) != int(response.headers.get("Content-Length", len(response.content))):
        raise RuntimeError("upload transfer was incomplete")
    return response.content, meta


def safe_filename(name: str, kind: str) -> str:
    name = Path(name.replace("\\", "/")).name
    name = re.sub(r"[^\w.() -]+", "_", name, flags=re.UNICODE).strip(" .")[:140]
    if not name or Path(name).suffix.lower() not in (".mp3", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus",
        ".wav", ".wma", ".aif", ".aiff", ".ape", ".alac", ".amr", ".mka", ".weba", ".mp4", ".mov", ".mkv",
        ".webm", ".avi", ".3gp", ".m4v"):
        raise RuntimeError("unsupported file extension")
    return name


def download_preview(url: str, dest: Path) -> Path:
    parts = urlsplit(url or "")
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not (host.endswith(".apple.com") or host == "apple.com" or
                                         host.endswith(".deezer.com") or host == "deezer.com" or
                                         host.endswith(".dzcdn.net") or host == "dzcdn.net"):
        raise RuntimeError("No official audio preview was found")
    if Path(parts.path).suffix.lower() not in (".mp3", ".m4a"):
        raise RuntimeError("The official preview format is not supported")
    size = 0
    try:
        with requests.get(url, stream=True, timeout=(15, 45)) as response:
            response.raise_for_status()
            with dest.open("wb") as target:
                for chunk in response.iter_content(64 * 1024):
                    if not chunk:
                        continue
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise RuntimeError("The official preview is too large")
                    target.write(chunk)
    except requests.RequestException as exc:
        raise RuntimeError("The official preview could not be downloaded") from exc
    if not size:
        raise RuntimeError("The official preview was empty")
    return dest


def notify_owner(chat_id: str | int | None, text: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not token or not chat_id:
        return
    try:
        requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      json={"chat_id": chat_id, "text": text}, timeout=12).raise_for_status()
    except requests.RequestException:
        print("[web-music] Telegram notification failed")


def owner_chat(station) -> int | None:
    """The station owner's Telegram chat: OWNER_IDS, else a chat the bot has seen whose hash is the stored owner."""
    from bot import config
    if config.OWNER_IDS:
        return min(config.OWNER_IDS)
    owner = station.state.get("owner")
    if not owner:
        return None
    seen = {item.get("chat") for group in ("asks", "catalog_jobs") for item in (station.state.get(group) or {}).values()
            if isinstance(item, dict)}
    for chat in seen:
        if isinstance(chat, int) and hmac.compare_digest(owner, hmac.new(
                config.TOKEN.encode(), str(chat).encode(), hashlib.sha256).hexdigest()):
            return chat
    return None


def _process_recognition(job_id: str, result_path: Path, data: bytes, meta: dict) -> None:
    try:
        payload = json.loads(data.decode("utf-8"))
        origin = payload.get("origin") or "shazam"
        raw = payload.get("track") or {}
        title, artist = str(raw.get("title") or "").strip(), str(raw.get("subtitle") or "").strip()
        if not title or not artist:
            raise RuntimeError("Shazam returned incomplete track info")
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError) as exc:
        raise RuntimeError("Shazam result is invalid") from exc

    from bot import lookup
    from bot.main import Station, variant_of

    fingerprint = {"title": title, "artist": artist, "album": "", "genre": "",
                   "cover": (raw.get("images") or {}).get("coverarthq") or (raw.get("images") or {}).get("coverart")}
    for section in raw.get("sections") or []:
        for item in section.get("metadata") or []:
            label, value = (item.get("title") or "").lower(), item.get("text") or ""
            if label == "album": fingerprint["album"] = value
            elif label == "released" and value[:4].isdigit(): fingerprint["year"] = int(value[:4])
            elif label == "genre": fingerprint["genre"] = value

    station = Station()
    existing = next((song for song in station.lib.songs if lookup.same_song(
        song["title"], song["artist"], title, artist)), None)
    if existing:
        outcome_song, outcome = existing, "duplicate"
    else:
        matches = lookup.search_candidates(title, artist, 0, fingerprint=fingerprint, limit=8)
        chosen = next((candidate for candidate in matches if candidate.get("preview_url") and
                       not variant_of(candidate.get("title", ""))), None)
        if not chosen:
            raise RuntimeError("Shazam found the song, but no official playable preview is available")

        preview_parts = urlsplit(chosen["preview_url"])
        extension = Path(preview_parts.path).suffix.lower()
        with tempfile.TemporaryDirectory(prefix="cavi-shazam-") as temp_dir:
            source = download_preview(chosen["preview_url"], Path(temp_dir) / f"preview{extension}")
            unique = "shazam:" + meta["fileKey"]
            media = {"file_name": f"{chosen['title']}{extension}", "file_unique_id": unique,
                     "file_size": source.stat().st_size, "performer": chosen.get("artist"),
                     "title": chosen.get("title")}
            progress = lambda message: update_status(job_id, "PROCESSING", message)
            outcome_song, outcome = station.import_song(
                {"message_id": 0, "caption": ""}, "shazam", media, str(meta["fileKey"]), progress,
                source_path=source, accept_variant=True, known=chosen)
            if outcome != "duplicate":
                station.lib.update(outcome_song, previewOnly=True,
                                   previewOfDuration=round(float(chosen.get("duration") or 0), 2))
            station.save()

    result = {key: outcome_song.get(key) for key in (
        "id", "title", "artist", "artists", "album", "duration", "src", "cover", "color")}
    result["outcome"] = outcome
    result["origin"] = origin
    result["telegramChatId"] = owner_chat(station) if origin == "dj-auto" else meta.get("uid")
    result_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    state = "DUPLICATE" if outcome == "duplicate" else "UPLOADING"
    message = "Bu qo'shiq stansiyada allaqachon bor." if outcome == "duplicate" else "Preview sayt kutubxonasiga saqlanmoqda…"
    update_status(job_id, state, message, result)


def process_recognition(job_id: str, result_path: Path, data: bytes, meta: dict) -> None:
    try:
        _process_recognition(job_id, result_path, data, meta)
    except Exception:
        try:
            origin = json.loads(data.decode("utf-8")).get("origin")
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            origin = "shazam"
        if origin == "dj-auto":
            raise  # a listener's request; the site shows the failure, the owner isn't disturbed
        source = "DJ" if origin == "dj" else "Shazam"
        notify_owner(meta.get("uid"),
                     f"⚠️ {source} topgan qo'shiqni saytga qo'sha olmadim. Rasmiy preview mavjudligini tekshirib ko'ring.")
        raise


def dl_key() -> str:
    return hashlib.sha256(f"cavi-dl:{os.environ.get('TELEGRAM_BOT_TOKEN', '')}".encode()).hexdigest()


def first_original(query: str) -> dict | None:
    """The bot's search, first result that is the original song (not a remix/cover/live/karaoke/lyrics video)."""
    from bot import quick
    from bot.main import variant_of

    return (original_candidates(query) or [None])[0]


def original_candidates(query: str, limit: int = 4) -> list[dict]:
    """The first original result and other uploads of the SAME song (its official video, another official
    audio…), best first. YouTube blocks some official audio uploads in some countries ("Video unavailable"):
    then the next upload of the same song is tried."""
    from bot import quick
    from bot.main import variant_of

    results = quick.search(query)
    asked_variant = bool(quick._VARIANT.search(query))
    clean = [r for r in results if asked_variant or not (quick._VARIANT.search(r["title"]) or variant_of(r["title"]))]
    official = [r for r in clean if r["kind"] in ("artist", "song")]
    ordered = official + [r for r in clean if r not in official]
    if not ordered:
        return []
    base = lambda r: re.sub(r"\s*[\(\[].*?[\)\]]", "", quick._norm(split_artist_title(r)[1])).strip()
    singer = lambda r: quick._norm((split_artist_title(r)[0] or "").split(",")[0])
    want, who = base(ordered[0]), singer(ordered[0])
    return [r for r in ordered if r is ordered[0] or (want and base(r) == want and who and singer(r) == who)][:limit]


def helper_mp3(candidates: list[dict], name: str, owner, first_helper_id: str | None = None) -> tuple[dict | None, dict]:
    """Asks the helper device for the MP3 of the first upload that works. Returns (upload used, helper result)."""
    import uuid

    got: dict = {}
    for i, cand in enumerate(candidates):
        helper_id = first_helper_id if i == 0 and first_helper_id else None
        if not helper_id:
            helper_id = str(uuid.uuid4())
            response = requests.post(f"{api_base()}/internal/dl/enqueue", headers={"X-Relay-Key": dl_key()}, timeout=20,
                                     json={"mode": "site", "job_id": helper_id, "chat_id": owner,
                                           "video_id": cand["id"], "line": name[:200]})
            response.raise_for_status()
            if not response.json().get("helperOnline"):
                raise RuntimeError("Yuklovchi qurilma o'chiq")
        got = wait_for_helper(helper_id, minutes=6)
        if got.get("file_id") and not got.get("error"):
            return cand, got
        error = str(got.get("error") or "")
        print(f"[web-music] helper error for {name!r} ({cand['id']}): {error}")
        if "available" not in error.lower() and "blocked" not in error.lower():
            break  # only a blocked/unavailable upload is worth retrying with another one
    return None, got


def split_artist_title(r: dict) -> tuple[str, str]:
    """YouTube Music songs carry artist and title; plain videos often have "Artist - Title" in the title."""
    from bot import quick

    title = re.sub(r"\s*[\(\[](official|music|video|audio|clip|lyric|hd|4k)[^\)\]]*[\)\]]", "", r["title"], flags=re.I).strip()
    artist = (r.get("artist") or "").strip()
    if " - " in title and (not artist or r["kind"] in ("video", "youtube")):
        left, right = title.split(" - ", 1)
        if not artist or quick._norm(artist.split(",")[0]) in quick._norm(left):
            artist, title = left.strip(), right.strip()
    return artist, title


def wait_for_helper(job_id: str, minutes: int = 12) -> dict:
    deadline = time.monotonic() + minutes * 60
    while time.monotonic() < deadline:
        try:
            response = requests.get(f"{api_base()}/internal/dl/result", params={"job": job_id},
                                    headers={"X-Relay-Key": dl_key()}, timeout=20)
            result = response.json().get("result") if response.ok else None
        except (requests.RequestException, ValueError):
            result = None
        if result:
            return result
        time.sleep(5)
    raise RuntimeError("Yuklovchi qurilma vaqtida javob bermadi")


def process_dj_query(job_id: str, result_path: Path, query: str) -> None:
    """Site DJ: the listener typed a song; add the bot's first original result to the station as a full song."""
    from bot import lookup
    from bot.main import Station

    update_status(job_id, "PROCESSING", "Bot qo'shiqni qidirmoqda…")
    candidates = original_candidates(query)
    chosen = candidates[0] if candidates else None
    if not chosen:
        raise RuntimeError("Hech narsa topilmadi")
    artist, title = split_artist_title(chosen)
    name = f"{artist} - {title}" if artist else title
    print(f"[web-music] DJ query {query!r} -> {chosen['id']} {name!r} ({chosen['kind']})")

    station = Station()
    existing = next((song for song in station.lib.songs if not song.get("previewOnly") and lookup.same_song(
        song["title"], song["artist"], title, artist)), None) if artist else None
    if existing:
        outcome_song, outcome = existing, "duplicate"
    else:
        owner = owner_chat(station)
        if not owner:
            raise RuntimeError("station owner chat is unknown")
        update_status(job_id, "PROCESSING", f"Topildi: {name}. Audio tayyorlanmoqda…",
                      {"title": title, "artist": artist})
        used, got = helper_mp3(candidates, name, owner)
        if not used:
            raise RuntimeError(f"Yuklovchi xatosi: {got.get('error') or 'fayl yo‘q'}")
        chosen = used

        with tempfile.TemporaryDirectory(prefix="cavi-dj-yt-") as temp_dir:
            source = Path(temp_dir) / "song.mp3"
            update_status(job_id, "PROCESSING", f"{name}: saytga qo'shilmoqda…", {"title": title, "artist": artist})
            station.bot.download(got["file_id"], source)
            if got.get("message_id"):
                station.bot.safe("deleteMessage", chat_id=got.get("chat_id") or owner, message_id=got["message_id"])
            unique = "yt:" + chosen["id"]
            media = {"file_name": f"{name}.mp3", "file_unique_id": unique, "file_size": source.stat().st_size,
                     "performer": artist, "title": title}
            last = [0.0]

            def progress(message: str) -> None:
                if time.monotonic() - last[0] >= 2:
                    last[0] = time.monotonic()
                    try:
                        update_status(job_id, "PROCESSING", message)
                    except requests.RequestException:
                        pass

            known = {"title": title, "artist": artist} if artist else None
            outcome_song, outcome = station.import_song(
                {"message_id": 0, "caption": ""}, "audio", media, unique, progress,
                source_path=source, accept_variant=True, known=known)
            station.save()

    result = {key: outcome_song.get(key) for key in (
        "id", "title", "artist", "artists", "album", "duration", "src", "cover", "color")}
    result.update({"outcome": outcome, "origin": "dj-yt", "query": query, "fullAudio": True,
                   "telegramChatId": owner_chat(station)})
    result_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    state = "DUPLICATE" if outcome == "duplicate" else "UPLOADING"
    message = "Bu qo'shiq stansiyada allaqachon bor." if outcome == "duplicate" else "Sayt kutubxonasiga saqlanmoqda…"
    update_status(job_id, state, message, result)


BATCH_BUDGET_SECONDS = 16 * 60  # one run; the rest continues in the next run of this workflow


def batch_progress(job_id: str) -> list:
    """Items already done by earlier runs of this batch (read back from the job's public status)."""
    origin = "https://" + (urlsplit(os.environ.get("SITE_URL") or "https://sultonmusic.github.io").hostname or "")
    try:
        response = requests.get(f"{api_base()}/api/music/dj-request/{job_id}", headers={"Origin": origin}, timeout=20)
        items = response.json().get("items") if response.ok else None
    except (requests.RequestException, ValueError):
        items = None
    return items if isinstance(items, list) else []


def continue_batch(job_id: str) -> bool:
    repo, token = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_TOKEN")
    if not (repo and token):
        return False
    try:
        response = requests.post(
            f"https://api.github.com/repos/{repo}/actions/workflows/web-music.yml/dispatches",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            json={"ref": os.environ.get("GITHUB_REF_NAME") or "main", "inputs": {"job_id": job_id}}, timeout=20)
        return response.status_code == 204
    except requests.RequestException:
        return False


def process_dj_batch(job_id: str, result_path: Path, queries: list[str]) -> None:
    """«Qo'shiq qo'shish» chat: many songs/artists in one list. Each line: the bot's first original result is
    added as a full song (or marked as already on the station). Items: [code, songId] in list order —
    a = added, d = already there, x = nothing found, f = failed."""
    import uuid
    from bot import lookup
    from bot.main import Station

    started = time.monotonic()
    items = batch_progress(job_id)[:len(queries)]
    station = Station()
    owner = owner_chat(station)
    if not owner:
        raise RuntimeError("station owner chat is unknown")
    total = len(queries)

    def report(message: str) -> None:
        try:
            update_status(job_id, "PROCESSING", message, {"origin": "dj-batch", "total": total, "items": items})
        except requests.RequestException as exc:
            print(f"[web-music] batch status failed: {exc}")

    def existing(artist: str, title: str) -> dict | None:
        if not artist:
            return None
        return next((s for s in station.lib.songs if not s.get("previewOnly") and lookup.same_song(
            s["title"], s["artist"], title, artist)), None)

    prepared: dict[int, tuple] = {}

    def prepare(k: int) -> None:
        """Search the line and, if the song is missing, ask the helper device to start making its MP3."""
        if k >= total or k in prepared:
            return
        try:
            candidates = original_candidates(queries[k])
        except Exception as exc:
            print(f"[web-music] search failed for {queries[k]!r}: {exc}")
            candidates = []
        chosen = candidates[0] if candidates else None
        if not chosen:
            prepared[k] = ("x", None)
            return
        artist, title = split_artist_title(chosen)
        dup = existing(artist, title)
        if dup:
            prepared[k] = ("d", dup["id"])
            return
        name = f"{artist} - {title}" if artist else title
        helper_id = str(uuid.uuid4())
        response = requests.post(f"{api_base()}/internal/dl/enqueue", headers={"X-Relay-Key": dl_key()}, timeout=20,
                                 json={"mode": "site", "job_id": helper_id, "chat_id": owner,
                                       "video_id": chosen["id"], "line": name[:200]})
        response.raise_for_status()
        if not response.json().get("helperOnline"):
            raise RuntimeError("Yuklovchi qurilma o'chiq")
        prepared[k] = ("q", (candidates, artist, title, name, helper_id))

    def add_prepared(data: tuple) -> tuple[str, str | None]:
        candidates, artist, title, name, helper_id = data
        chosen, got = helper_mp3(candidates, name, owner, first_helper_id=helper_id)
        if not chosen:
            return "f", None
        with tempfile.TemporaryDirectory(prefix="cavi-dj-batch-") as temp_dir:
            source = Path(temp_dir) / "song.mp3"
            station.bot.download(got["file_id"], source)
            if got.get("message_id"):
                station.bot.safe("deleteMessage", chat_id=got.get("chat_id") or owner, message_id=got["message_id"])
            unique = "yt:" + chosen["id"]
            media = {"file_name": f"{name}.mp3", "file_unique_id": unique, "file_size": source.stat().st_size,
                     "performer": artist, "title": title}
            song, outcome = station.import_song(
                {"message_id": 0, "caption": ""}, "audio", media, unique, lambda _m: None,
                source_path=source, accept_variant=True, known={"title": title, "artist": artist} if artist else None)
            station.save()
        return ("d" if outcome == "duplicate" else "a"), song.get("id")

    stopped = ""
    k = len(items)
    report(f"{k}/{total} tayyor. Davom etmoqda…")
    while k < total:
        if time.monotonic() - started > BATCH_BUDGET_SECONDS:
            break
        try:
            prepare(k)
            if time.monotonic() - started < BATCH_BUDGET_SECONDS - 180:
                try:
                    prepare(k + 1)  # the phone makes the next MP3 while this one is being added
                except Exception as exc:
                    print(f"[web-music] prefetch {k + 1} failed: {exc}")
            kind, data = prepared.pop(k)
            items.append([kind, data] if kind != "q" else list(add_prepared(data)))
        except RuntimeError as exc:
            if "o'chiq" in str(exc):
                stopped = str(exc)
                break
            print(f"[web-music] batch item {k} failed: {exc}")
            items.append(["f", None])
        except Exception as exc:
            print(f"[web-music] batch item {k} failed: {exc}")
            items.append(["f", None])
        k += 1
        report(f"{k}/{total} tayyor…")

    added = sum(1 for code, _ in items if code == "a")
    result = {"origin": "dj-batch", "total": total, "items": items, "outcome": "added",
              "telegramChatId": owner}
    if stopped:
        result["stopped"] = stopped
    elif k < total:
        result["continued"] = continue_batch(job_id)
        if not result["continued"]:
            result["stopped"] = "Davom ettirib bo'lmadi"
    result_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    report(f"{k}/{total} tayyor ({added} ta qo'shildi)" + (" — davom etadi…" if result.get("continued") else ""))


def process(job_id: str, result_path: Path) -> None:
    if not JOB_ID_RE.fullmatch(job_id):
        raise RuntimeError("invalid job id")
    update_status(job_id, "PROCESSING", "Audio/video tahlil qilinmoqda…")
    data, meta = fetch_upload(job_id)
    if meta["kind"] == "identify":
        try:
            request = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            request = {}
        if isinstance(request, dict) and request.get("origin") == "dj-yt":
            process_dj_query(job_id, result_path, str(request.get("query") or "").strip()[:120])
            return
        if isinstance(request, dict) and request.get("origin") == "dj-batch":
            queries = [str(q).strip()[:120] for q in request.get("queries") or [] if str(q).strip()][:300]
            process_dj_batch(job_id, result_path, queries)
            return
        process_recognition(job_id, result_path, data, meta)
        return
    name = safe_filename(str(meta.get("fileName") or "upload"), meta["kind"])
    with tempfile.TemporaryDirectory(prefix="cavi-web-music-") as temp_dir:
        source = Path(temp_dir) / name
        source.write_bytes(data)
        from bot.main import Station

        station = Station()
        last_update = 0.0

        def progress(message: str) -> None:
            nonlocal last_update
            now = time.monotonic()
            if now - last_update >= 2:
                try:
                    update_status(job_id, "PROCESSING", message)
                    last_update = now
                except requests.RequestException as exc:
                    print(f"[web-music] status update failed: {exc}")

        media = {"file_name": name, "file_unique_id": str(meta["fileKey"]), "file_size": len(data)}
        existing = station.lib.by_file(str(meta["fileKey"])) or next(
            (song for song in station.lib.songs if song.get("videoKey") == meta["fileKey"]), None)
        if existing:
            outcome_song, outcome = existing, "duplicate"
        else:
            outcome_song, outcome = station.import_song(
                {"message_id": 0, "caption": ""}, meta["kind"], media, str(meta["fileKey"]), progress,
                source_path=source, accept_variant=True)
        result = {key: outcome_song.get(key) for key in (
            "id", "title", "artist", "artists", "album", "duration", "src", "cover", "color", "video", "videoOffset")}
        result["outcome"] = outcome
        result_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        state = "DUPLICATE" if outcome == "duplicate" else "UPLOADING"
        message = "Bu qo'shiq stansiyada allaqachon bor." if outcome == "duplicate" else "Sayt kutubxonasiga saqlanmoqda…"
        update_status(job_id, state, message, result)


def finalize(job_id: str, result_path: Path, workflow_outcome: str) -> None:
    if workflow_outcome == "success" and result_path.exists():
        result = json.loads(result_path.read_text(encoding="utf-8"))
        if result.get("origin") == "dj-batch":
            items = result.get("items") or []
            done = len(items)
            added = sum(1 for code, _ in items if code == "a")
            if result.get("continued"):
                update_status(job_id, "PROCESSING", f"{done}/{result.get('total')} tayyor — davom etadi…", result)
                return
            if result.get("stopped"):
                update_status(job_id, "FAILED", f"To'xtadi: {result['stopped']} ({done}/{result.get('total')})", result)
            else:
                update_status(job_id, "COMPLETED", f"Tayyor: {added} ta qo'shildi", result)
            if added:
                had = sum(1 for code, _ in items if code == "d")
                notify_owner(result.get("telegramChatId"),
                             f"📄 Saytdagi «Qo'shiq qo'shish» ro'yxati: {added} ta yangi qo'shiq qo'shildi, "
                             f"{had} tasi avvaldan bor edi (jami {result.get('total')}).")
            return
        status = "DUPLICATE" if result.get("outcome") == "duplicate" else "COMPLETED"
        message = "Qo'shiq stansiyada bor." if status == "DUPLICATE" else "Tayyor — saytda oching yoki ijro eting."
        update_status(job_id, status, message, result)
        title = f"{result.get('artist') or ''} — {result.get('title') or ''}".strip(" —")
        if result.get("origin") == "dj-yt":
            if status != "DUPLICATE":
                notify_owner(result.get("telegramChatId"),
                             f"🎧 Saytdagi DJ so'rovi: «{result.get('query') or ''}»\n\n{title} — to'liq qo'shiq saytga qo'shildi.")
            return
        if result.get("origin") == "dj-auto":
            if status != "DUPLICATE":
                notify_owner(result.get("telegramChatId"),
                             f"🎧 Saytdagi DJ'da so'rashdi: {title}\n\nRasmiy katalog lavhasi saytga qo'shildi. "
                             "To'liq versiyasi sizda bo'lsa, audio faylni shu botga yuboring — saytdagi lavha "
                             "o'zi to'liq versiyaga almashadi.")
            return
        icon = "ℹ️" if status == "DUPLICATE" else "✅"
        detail = ("saytda avvaldan bor." if status == "DUPLICATE"
                  else "saytga qo'shildi; previewni tinglashingiz mumkin.")
        notify_owner(result.get("telegramChatId"),
                     f"{icon} {title} {detail}")
        return
    update_status(job_id, "FAILED", "Faylni qayta ishlash yoki saytga joylash amalga oshmadi. Yana urinib ko'ring.")
    if result_path.exists():
        try:
            failed = json.loads(result_path.read_text(encoding="utf-8"))
            if failed.get("origin") == "dj-auto":
                return
            notify_owner(failed.get("telegramChatId"),
                         "⚠️ Shazam topgan qo'shiqni saytga joylay olmadim. Boshqa trekni sinab ko'ring.")
        except (ValueError, OSError):
            pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--finalize", action="store_true")
    args = parser.parse_args()
    try:
        if args.finalize:
            finalize(args.job_id, args.result, os.environ.get("WORKFLOW_OUTCOME", "failure"))
        else:
            process(args.job_id, args.result)
        return 0
    except Exception as exc:
        if not args.finalize:
            traceback.print_exc()
            try:
                update_status(args.job_id, "FAILED", "Faylni qayta ishlash amalga oshmadi. Yana urinib ko'ring.")
            except Exception as update_exc:
                print(f"[web-music] could not report failure: {update_exc}")
        else:
            print(f"[web-music] finalize failed: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
