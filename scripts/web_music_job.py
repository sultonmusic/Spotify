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

    from bot import lookup, config
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

    # Public DJ requests first try a full-length Jamendo recording. Jamendo only returns tracks
    # whose artists explicitly allow downloads; acquire.jamendo_audio validates the full file
    # and preserves the Creative Commons licence/attribution in the song origin metadata.
    if origin == "dj-auto" and config.JAMENDO_CLIENT_ID and (not existing or existing.get("previewOnly")):
        from bot import acquire, audio
        try:
            progress = lambda message: update_status(job_id, "PROCESSING", message)
            progress("Jamendo'da yuklab olishga ruxsat berilgan to'liq audio qidirilmoqda…")
            row = acquire.jamendo_find(title, artist, float(fingerprint.get("duration") or 0))
            if row:
                with tempfile.TemporaryDirectory(prefix="cavi-jamendo-") as temp_dir:
                    temp = Path(temp_dir)
                    tags = {"title": title, "artist": artist, "album": fingerprint.get("album") or "",
                            "date": str(fingerprint.get("year") or "")}
                    got = acquire.jamendo_audio(row, temp, tags)
                    info = audio.probe(got.path)
                    if config.SHAZAM_ENABLED:
                        clip = audio.excerpt(got.path, temp / "verify.wav", info)
                        heard = lookup.shazam(clip) if clip else None
                        if heard and not lookup.same_song(heard.get("title", ""), heard.get("artist", ""),
                                                          title, artist):
                            raise RuntimeError("Jamendo audiosi so'ralgan qo'shiqqa mos kelmadi")

                    file_key = hashlib.sha1(got.stable_key.encode()).hexdigest()[:16]
                    media = {"file_unique_id": "source:" + got.stable_key,
                             "file_name": f"{title}.mp3", "file_size": got.path.stat().st_size,
                             "performer": artist, "title": title}
                    known = {**fingerprint, "title": title, "artist": artist}
                    outcome_song, outcome = station.import_song(
                        {"message_id": 0, "caption": ""}, "jamendo", media, file_key, progress,
                        force=True, source_path=got.path, accept_variant=True, known=known)
                    if outcome == "added":
                        station.lib.update(outcome_song, origin=got.origin(),
                                           sources=sorted(set(outcome_song.get("sources") or []) | {"jamendo"}))
                        station.save()
                        result = {key: outcome_song.get(key) for key in (
                            "id", "title", "artist", "artists", "album", "duration", "src", "cover", "color")}
                        result.update({"outcome": "added", "origin": origin, "fullAudio": True,
                                       "provider": got.provider, "license": got.license,
                                       "licenseUrl": got.license_url, "attribution": got.attribution,
                                       "telegramChatId": owner_chat(station)})
                        result_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
                        update_status(job_id, "UPLOADING", "To'liq audio Cavi Music kutubxonasiga saqlanmoqda…", result)
                        return
        except Exception as exc:
            # A Jamendo miss or unavailable track is not fatal: continue with the existing
            # official-preview flow rather than blocking a DJ request.
            print(f"[web-music] Jamendo full-track fallback: {exc}")

    if existing and not existing.get("previewOnly"):
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

    results = quick.search(query)
    asked_variant = bool(quick._VARIANT.search(query))
    clean = [r for r in results if asked_variant or not (quick._VARIANT.search(r["title"]) or variant_of(r["title"]))]
    official = [r for r in clean if r["kind"] in ("artist", "song")]
    return (official or clean or [None])[0]


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
    chosen = first_original(query)
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
        job = {"mode": "site", "job_id": job_id, "chat_id": owner, "video_id": chosen["id"], "line": name[:200]}
        response = requests.post(f"{api_base()}/internal/dl/enqueue", json=job,
                                 headers={"X-Relay-Key": dl_key()}, timeout=20)
        response.raise_for_status()
        if not response.json().get("helperOnline"):
            raise RuntimeError("Yuklovchi qurilma o'chiq")
        got = wait_for_helper(job_id)
        if got.get("error") or not got.get("file_id"):
            raise RuntimeError(f"Yuklovchi xatosi: {got.get('error') or 'fayl yo‘q'}")

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
                if result.get("fullAudio"):
                    source = result.get("provider") or "ruxsatli manba"
                    licence = result.get("license") or "litsenziya ma'lumoti mavjud"
                    notify_owner(result.get("telegramChatId"),
                                 f"🎧 Saytdagi DJ so'rovi: {title}\n\nTo'liq audio {source} orqali saytga qo'shildi. "
                                 f"Manba litsenziyasi: {licence}.")
                else:
                    notify_owner(result.get("telegramChatId"),
                                 f"🎧 Saytdagi DJ'da so'rashdi: {title}\n\nRasmiy katalog preview'i saytga qo'shildi. "
                                 "To'liq versiyasi sizda bo'lsa, audio faylni shu botga yuboring — preview "
                                 "to'liq versiyaga almashtiriladi.")
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
