"""Cavi Music — kompyuterdagi MP3 yordamchi.

YouTube GitHub serverlaridan yuklashni bloklaydi. Shuning uchun botda raqam bosilganda
stansiya ishni Cloudflare navbatiga qo'yadi, bu dastur esa uni uy internetida yuklab,
qo'shiqni foydalanuvchiga o'zi yuboradi.

Saytdagi DJ so'rovlari ham shu yerdan o'tadi: MP3 egasining chatiga jim yuboriladi,
stansiya uni o'sha yerdan olib saytga qo'shadi.

Ishga tushirish:  python helper.py   (yoki run_helper.bat — to'xtasa o'zi qayta yoqiladi)
Token .env faylida:  BOT_TOKEN=...
Yangilanish: har ishga tushganda GitHub'dagi eng so'nggi helper.py tekshiriladi.
"""
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

import requests
import yt_dlp

HERE = Path(__file__).resolve().parent
RELAY = "https://cavi-music-relay.sales-infarmatik-tj.workers.dev"
UPDATE_URL = "https://raw.githubusercontent.com/sultonmusic/Spotify/feature/cavi-universal-music-search/helper/helper.py"
CACHE_FILE = HERE / "helper_cache.json"
MAX_UPLOAD = 50 * 1024 * 1024


def load_token() -> str:
    env = HERE / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("BOT_TOKEN="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("BOT_TOKEN", "")


TOKEN = load_token()
API = f"https://api.telegram.org/bot{TOKEN}/"
KEY = hashlib.sha256(f"cavi-dl:{TOKEN}".encode()).hexdigest()
session = requests.Session()


def log(*args):
    print(time.strftime("%H:%M:%S"), *args, flush=True)


def tg(method: str, **params):
    try:
        r = session.post(API + method, json={k: v for k, v in params.items() if v is not None}, timeout=30)
        data = r.json()
        return data.get("result") if data.get("ok") else None
    except (requests.RequestException, ValueError):
        return None


def load_cache() -> dict:
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


cache = load_cache()  # {video_id: telegram file_id} — qayta so'ralsa darhol yuboriladi


def remember(video_id: str, file_id: str) -> None:
    cache[video_id] = file_id
    CACHE_FILE.write_text(json.dumps(cache), encoding="utf-8")


def to_mp3(video_id: str, folder: Path) -> dict:
    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(folder / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    path = folder / f"{info['id']}.mp3"
    if path.stat().st_size > MAX_UPLOAD:
        raise ValueError(f"Audio juda katta ({path.stat().st_size // (1024 * 1024)} MB). Chegara: 50 MB.")
    return {"path": path, "title": info.get("title") or video_id,
            "performer": (info.get("artist") or info.get("uploader") or "").strip(),
            "duration": int(info.get("duration") or 0)}


def split_line(line: str):
    """"Ijrochi - Nomi" → (ijrochi, nom) — Telegram'da audio nomi chiroyli chiqishi uchun."""
    if " - " in line:
        artist, title = line.split(" - ", 1)
        return artist.strip(), title.strip()
    return None, None


def upload_mp3(chat_id, video_id: str, line: str, silent: bool = False) -> dict:
    """MP3 tayyorlab Telegram'ga yuboradi; Telegram javobidagi xabarni qaytaradi."""
    with tempfile.TemporaryDirectory() as tmp:
        a = to_mp3(video_id, Path(tmp))
        artist, title = split_line(line or "")
        data = {"chat_id": chat_id, "title": title or a["title"], "performer": artist or a["performer"],
                "duration": a["duration"], "disable_notification": "true" if silent else None}
        with open(a["path"], "rb") as fh:
            r = session.post(API + "sendAudio", data={k: str(v) for k, v in data.items() if v},
                             files={"audio": (f"{(artist + ' - ' + title) if artist else a['title']}.mp3", fh)},
                             timeout=300)
        res = r.json()
    if not res.get("ok"):
        raise RuntimeError(res.get("description") or "sendAudio failed")
    file_id = (res["result"].get("audio") or {}).get("file_id")
    if file_id:
        remember(video_id, file_id)
    return res["result"]


def report(job_id: str, **result) -> None:
    for _ in range(5):
        try:
            r = session.post(f"{RELAY}/internal/dl/result", json={"job_id": job_id, **result},
                             headers={"X-Relay-Key": KEY}, timeout=20)
            if r.ok:
                return
        except requests.RequestException:
            pass
        time.sleep(3)


def handle_site(job: dict) -> None:
    """Saytdagi DJ so'rovi: MP3 egasining chatiga jim yuboriladi, file_id stansiyaga qaytariladi."""
    job_id, video_id = job["job_id"], job["video_id"]
    log("sayt:", video_id, job.get("line", ""))
    try:
        if video_id in cache:
            report(job_id, file_id=cache[video_id])
            log("sayt (keshdan):", video_id)
            return
        msg = upload_mp3(job["chat_id"], video_id, job.get("line") or "", silent=True)
        report(job_id, file_id=(msg.get("audio") or {}).get("file_id"), message_id=msg.get("message_id"),
               chat_id=job["chat_id"])
        log("sayt uchun tayyor:", video_id)
    except Exception as exc:
        reason = re.sub(r"\x1b\[[0-9;]*m", "", str(exc)).strip().split("\n")[0][:250]
        log("sayt xatosi:", video_id, reason)
        report(job_id, error=reason)


def handle(job: dict) -> None:
    if job.get("mode") == "site":
        handle_site(job)
        return
    chat_id, video_id = job["chat_id"], job["video_id"]
    log("ish:", video_id, job.get("line", ""))
    try:
        if video_id in cache and tg("sendAudio", chat_id=chat_id, audio=cache[video_id]):
            return
        tg("sendChatAction", chat_id=chat_id, action="upload_voice")
        upload_mp3(chat_id, video_id, job.get("line") or "")
        log("yuborildi:", video_id)
    except Exception as exc:
        reason = re.sub(r"\x1b\[[0-9;]*m", "", str(exc)).strip().split("\n")[0][:250]
        log("xato:", video_id, reason)
        tg("sendMessage", chat_id=chat_id, text=f"❌ Bu qo'shiqni audioga aylantirib bo'lmadi. "
                                                f"Ro'yxatdan boshqasini tanlang.\n{reason}")
    finally:
        if job.get("wait_id"):
            tg("deleteMessage", chat_id=chat_id, message_id=job["wait_id"])


def self_update() -> None:
    """GitHub'da yangi versiya bo'lsa, faylni almashtirib qayta ishga tushadi."""
    try:
        r = session.get(UPDATE_URL, timeout=20)
        new = r.text if r.ok else ""
        me = Path(__file__).resolve()
        if new.startswith('"""Cavi Music') and "def main()" in new and new != me.read_text(encoding="utf-8"):
            me.write_text(new, encoding="utf-8")
            log("Yordamchi yangilandi, qayta ishga tushmoqda...")
            os.execv(sys.executable, [sys.executable, str(me)])
    except Exception as exc:
        log("yangilanishni tekshirib bo'lmadi:", exc)


def main() -> None:
    if not TOKEN:
        raise SystemExit(".env faylida BOT_TOKEN topilmadi.")
    self_update()
    log("Yordamchi ishga tushdi. Navbat kutilmoqda...")
    while True:
        try:
            r = session.get(f"{RELAY}/internal/dl/claim", params={"timeout": 20},
                            headers={"X-Relay-Key": KEY}, timeout=40)
            if r.status_code == 404:
                log("Navbat hali deploy qilinmagan (404). 30 soniyadan keyin qayta urinaman.")
                time.sleep(30)
                continue
            r.raise_for_status()
            job = r.json().get("job")
        except (requests.RequestException, ValueError) as exc:
            log("ulanish xatosi:", exc)
            time.sleep(5)
            continue
        if isinstance(job, dict) and job.get("chat_id") and job.get("video_id"):
            if job.get("mode") == "site" and not job.get("job_id"):
                log("noto'g'ri sayt ishi o'tkazib yuborildi:", job)
                continue
            handle(job)
        elif job:
            log("noto'g'ri ish o'tkazib yuborildi:", job)


if __name__ == "__main__":
    main()
