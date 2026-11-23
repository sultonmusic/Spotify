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


def _process_recognition(job_id: str, result_path: Path, data: bytes, meta: dict) -> None:
    try:
        payload = json.loads(data.decode("utf-8"))
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
    result["telegramChatId"] = meta.get("uid")
    result_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    state = "DUPLICATE" if outcome == "duplicate" else "UPLOADING"
    message = "Bu qo'shiq stansiyada allaqachon bor." if outcome == "duplicate" else "Preview sayt kutubxonasiga saqlanmoqda…"
    update_status(job_id, state, message, result)


def process_recognition(job_id: str, result_path: Path, data: bytes, meta: dict) -> None:
    try:
        _process_recognition(job_id, result_path, data, meta)
    except Exception:
        notify_owner(meta.get("uid"),
                     "⚠️ Shazam topgan qo'shiqni saytga qo'sha olmadim. Rasmiy preview mavjudligini tekshirib ko'ring.")
        raise


def process(job_id: str, result_path: Path) -> None:
    if not JOB_ID_RE.fullmatch(job_id):
        raise RuntimeError("invalid job id")
    update_status(job_id, "PROCESSING", "Audio/video tahlil qilinmoqda…")
    data, meta = fetch_upload(job_id)
    if meta["kind"] == "identify":
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
        icon = "ℹ️" if status == "DUPLICATE" else "✅"
        detail = ("saytda avvaldan bor." if status == "DUPLICATE"
                  else "saytga qo'shildi; previewni tinglashingiz mumkin.")
        notify_owner(result.get("telegramChatId"),
                     f"{icon} {title} {detail}")
        return
    update_status(job_id, "FAILED", "Faylni qayta ishlash yoki saytga joylash amalga oshmadi. Yana urinib ko'ring.")
    if result_path.exists():
        try:
            notify_owner(json.loads(result_path.read_text(encoding="utf-8")).get("telegramChatId"),
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
