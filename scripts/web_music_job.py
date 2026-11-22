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
    if meta.get("kind") not in ("audio", "video") or not JOB_ID_RE.fullmatch(job_id):
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


def process(job_id: str, result_path: Path) -> None:
    if not JOB_ID_RE.fullmatch(job_id):
        raise RuntimeError("invalid job id")
    update_status(job_id, "PROCESSING", "Audio/video tahlil qilinmoqda…")
    data, meta = fetch_upload(job_id)
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
        return
    update_status(job_id, "FAILED", "Faylni qayta ishlash yoki saytga joylash amalga oshmadi. Yana urinib ko'ring.")


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
