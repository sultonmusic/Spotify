"""Yangi qidiruv va aniqlash (Cavi Music bot).

* Qo'shiq nomi yozilsa — raqamlangan ro'yxat (1–10), ostida raqam tugmalari va ⬅️ ➡️.
* Raqam bosilsa — o'sha video MP3 qilib yuboriladi (bir marta yuborilgani keyin darhol keladi).
* YouTube havolasi yuborilsa — darhol MP3.
* Ovozli xabar / audio (egasidan boshqa odamlardan) — qo'shiq aniqlanadi va to'liq versiyalar ro'yxati chiqadi.

Ro'yxat hech qayerda saqlanmaydi: sahifa almashtirilganda qidiruv xabarning birinchi qatoridan
qayta bajariladi (shu sababli foydalanuvchilar qidiruvi repozitoriyga yozilmaydi).
"""
from __future__ import annotations

import html
import re
import tempfile
from pathlib import Path
from typing import Any

from . import audio, lookup
from .telegram_api import TelegramError

PAGE_SIZE = 10
SEARCH_COUNT = 30
MAX_DURATION = 35 * 60          # bundan uzun videolar 50 MB dan oshadi — ro'yxatga kirmaydi
MAX_UPLOAD = 50 * 1024 * 1024   # Telegram botlari yubora oladigan eng katta fayl
FILE_CACHE_LIMIT = 500

YT_RE = re.compile(
    r"(?:https?://)?(?:www\.|m\.|music\.)?(?:youtube\.com/(?:watch\?v=|shorts/|live/)|youtu\.be/)([\w\-]{11})")


def esc(text: Any) -> str:
    return html.escape(str(text or ""), quote=False)


def fmt_duration(sec: int) -> str:
    return f"{sec // 60}:{sec % 60:02d}"


def short(text: str, n: int = 55) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


# ------------------------------------------------------------------ YouTube

def youtube_id(text: str) -> str | None:
    m = YT_RE.search(text or "")
    return m.group(1) if m else None


# Qidiruvda so'ralmagan bo'lsa pastga tushiriladigan versiyalar (remix, karaoke, treyler, ...)
_VARIANT = re.compile(
    r"\b(remix|rmx|karaoke|cover|live|concert|slowed|sped|speed up|nightcore|reverb|8d|instrumental|minus|"
    r"lyrics?|amv|edit|trailer|teaser|scene|clip|reaction|tutorial|piano|guitar|vocals only)\b", re.I)


def _norm(text: str) -> str:
    """Solishtirish uchun: kichik harf, apostroflarsiz, o'zbekcha x/h farqisiz."""
    text = (text or "").lower()
    text = re.sub(r"[’'`ʻʼ‘]", "", text)
    return text.replace("x", "h")


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"\w+", _norm(text)) if len(w) > 1 or w.isdigit()]


def _word_hit(word: str, hay: list[str]) -> bool:
    from difflib import SequenceMatcher
    return any(word == h or (len(word) > 3 and SequenceMatcher(None, word, h).ratio() >= 0.88) for h in hay)


def _ytmusic_results(query: str) -> list[dict]:
    """YouTube Music: rasmiy qo'shiqlar (songs), keyin kliplar (videos); ijrochi nomi aniq mos kelsa — uning qo'shiqlari."""
    from ytmusicapi import YTMusic

    yt = YTMusic()
    items: list[dict] = []

    def add(r: dict, kind: str) -> None:
        if not r.get("videoId"):
            return
        artist = ", ".join(a["name"] for a in (r.get("artists") or []) if a.get("name"))
        items.append({"id": r["videoId"], "title": r.get("title") or "", "artist": artist,
                      "duration": int(r.get("duration_seconds") or 0), "kind": kind})

    if len(_words(query)) <= 3:  # "Shoxrux Mirzo" — ijrochining o'z qo'shiqlari
        try:
            from difflib import SequenceMatcher
            for a in yt.search(query, filter="artists", limit=3)[:1]:
                if SequenceMatcher(None, _norm(a.get("artist")), _norm(query)).ratio() >= 0.9 and a.get("browseId"):
                    for r in ((yt.get_artist(a["browseId"]).get("songs") or {}).get("results") or [])[:10]:
                        add(r, "artist")
        except Exception as exc:
            print(f"[quick] artist: {exc}")
    for r in yt.search(query, filter="songs", limit=20):
        add(r, "song")
    for r in yt.search(query, filter="videos", limit=20):
        add(r, "video")
    return items


def _youtube_results(query: str) -> list[dict]:
    """Oddiy YouTube qidiruvi (YouTube Music ishlamasa)."""
    import yt_dlp

    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "extract_flat": True}) as ydl:
        res = ydl.extract_info(f"ytsearch{SEARCH_COUNT}:{query}", download=False)
    return [{"id": e["id"], "title": e.get("title") or e["id"], "artist": "",
             "duration": int(e.get("duration") or 0), "kind": "youtube"}
            for e in (res or {}).get("entries") or [] if e.get("id")]


def search(query: str) -> list[dict]:
    """Eng moslari yuqorida: [{"id", "title", "artist", "duration", "kind"}]."""
    items: list[dict] = []
    try:
        items = _ytmusic_results(query)
    except Exception as exc:
        print(f"[quick] ytmusic: {exc}")
    if len(items) < 5:
        try:
            items += _youtube_results(query)
        except Exception as exc:
            print(f"[quick] youtube: {exc}")

    qwords = _words(query)
    asked_variant = bool(_VARIANT.search(query))
    bonus = {"artist": 20, "song": 15, "video": 5, "youtube": 0}
    scored, seen_ids = [], set()
    for i, r in enumerate(items):
        if r["id"] in seen_ids or r["duration"] > MAX_DURATION:
            continue
        seen_ids.add(r["id"])
        hay = _words(f"{r['artist']} {r['title']}")
        coverage = sum(_word_hit(w, hay) for w in qwords) / max(1, len(qwords))
        score = coverage * 100 + bonus[r["kind"]] - i * 0.3
        if not asked_variant and _VARIANT.search(r["title"]):
            score -= 30
        if r["duration"] > 15 * 60:
            score -= 40
        scored.append((score, r))
    scored.sort(key=lambda x: -x[0])

    # Bir xil qo'shiqning nusxalari (ijrochi + nom bir xil) — faqat eng yaxshisi qoladi
    out, seen_keys = [], set()
    for _, r in scored:
        key = (_norm(r["artist"]), re.sub(r"\s*[\(\[].*?[\)\]]", "", _norm(r["title"])).strip())
        if r["artist"] and key in seen_keys:
            continue
        seen_keys.add(key)
        out.append(r)
    return out[:SEARCH_COUNT]


def label(r: dict) -> str:
    """Ro'yxatdagi yozuv: "Ijrochi - Nomi" (nomda ijrochi bo'lsa, faqat nom)."""
    if r.get("artist") and _norm(r["artist"].split(",")[0]) not in _norm(r["title"]):
        return f"{r['artist']} - {r['title']}"
    return r["title"]


def to_mp3(video_id: str, folder: Path) -> dict:
    """Videoni MP3 ga aylantiradi: {"path", "title", "performer", "duration"}."""
    import yt_dlp

    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(folder / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    path = folder / f"{info['id']}.mp3"
    if path.stat().st_size > MAX_UPLOAD:
        raise ValueError(f"Audio juda katta ({path.stat().st_size // (1024 * 1024)} MB). Chegara: 50 MB.")
    return {"path": path, "title": info.get("title") or video_id,
            "performer": info.get("uploader") or "", "duration": int(info.get("duration") or 0)}


# ------------------------------------------------------------------ bot qismi

class QuickSearch:
    def __init__(self, station) -> None:
        self.st = station
        self.bot = station.bot

    # ---------- ro'yxat
    def page(self, query: str, header: str, page: int) -> tuple[str, dict] | None:
        results = search(query)
        if not results:
            return None
        pages = (len(results) + PAGE_SIZE - 1) // PAGE_SIZE
        page = max(0, min(page, pages - 1))
        start = page * PAGE_SIZE
        chunk = results[start:start + PAGE_SIZE]
        lines = []
        for i, r in enumerate(chunk, start=start + 1):
            dur = f" <b>{fmt_duration(r['duration'])}</b>" if r["duration"] else ""
            lines.append(f"{i}. <i>{esc(short(label(r)))}</i>{dur}")
        text = header + "\n\n" + "\n".join(lines)
        nums = [{"text": str(i), "callback_data": f"dl:{r['id']}"} for i, r in enumerate(chunk, start=start + 1)]
        rows = [nums[j:j + 5] for j in range(0, len(nums), 5)]
        nav = []
        if page > 0:
            nav.append({"text": "⬅️", "callback_data": f"pg:{page - 1}"})
        if page < pages - 1:
            nav.append({"text": "➡️", "callback_data": f"pg:{page + 1}"})
        if nav:
            rows.append(nav)
        return text, {"inline_keyboard": rows}

    def send_list(self, chat_id: int, query: str, header: str, reply_to: int | None, photo: str | None = None) -> None:
        """header ning birinchi qatori — qidiruv so'zi (sahifa almashtirishda shundan qayta qidiriladi)."""
        self.bot.safe("sendChatAction", chat_id=chat_id, action="typing")
        try:
            built = self.page(query, header, 0)
        except Exception as exc:
            print(f"[quick] search: {exc}")
            self.st.send(chat_id, "⚠️ Qidiruv vaqtincha ishlamadi. Birozdan keyin qayta urinib ko'ring.",
                         reply_to=reply_to)
            return
        if not built:
            self.st.send(chat_id, f"🔍 «{esc(query)}» bo'yicha hech narsa topilmadi.", reply_to=reply_to)
            return
        text, markup = built
        if photo and len(text) <= 1024:
            sent = self.bot.safe("sendPhoto", chat_id=chat_id, photo=photo, caption=text, parse_mode="HTML",
                                 reply_markup=markup)
            if sent:
                return
        self.st.send(chat_id, text, reply_to=reply_to, markup=markup)

    def handle_text(self, msg: dict, text: str) -> None:
        chat_id = msg["chat"]["id"]
        vid = youtube_id(text)
        if vid:
            self.send_mp3(chat_id, vid, msg["message_id"])
            return
        query = text.split("\n", 1)[0].strip()[:200]
        self.send_list(chat_id, query, esc(query), msg["message_id"])

    # ---------- MP3
    def library_song(self, line: str) -> dict | None:
        """Ro'yxat qatori ("Ijrochi - Nomi") stansiya kutubxonasidagi qo'shiqqa mos kelsa — o'sha qo'shiq."""
        if " - " not in line:
            return None
        artist, title = line.split(" - ", 1)
        title = re.sub(r"\s*[\(\[].*?[\)\]]", "", title).strip()
        for song in self.st.lib.songs:
            if song.get("src") and lookup.same_song(song["title"], song["artist"], title, artist):
                return song
        return None

    def send_library_song(self, chat_id: int, song: dict) -> bool:
        """Stansiyadagi rasmiy faylni saytdan to'g'ridan-to'g'ri yuboradi (YouTube kerak emas)."""
        src = song["src"] if song["src"].startswith("http") else (self.st.site or "") + song["src"]
        if not src.startswith("https://"):
            return False
        sent = self.bot.safe("sendAudio", chat_id=chat_id, audio=src, title=song["title"],
                             performer=song["artist"], duration=int(song.get("duration") or 0))
        return bool(sent)

    def send_mp3(self, chat_id: int, video_id: str, reply_to: int | None = None, line: str = "") -> None:
        cache = self.st.state.setdefault("yt_files", {})
        if video_id in cache:  # avval yuborilgan — darhol jo'natamiz
            if self.bot.safe("sendAudio", chat_id=chat_id, audio=cache[video_id]):
                return
            cache.pop(video_id, None)
            self.st.state_dirty = True

        song = self.library_song(line)
        if song and self.send_library_song(chat_id, song):
            return

        wait = self.st.send(chat_id, "⏳ Audio tayyorlanmoqda...")
        self.bot.safe("sendChatAction", chat_id=chat_id, action="upload_voice")
        try:
            with tempfile.TemporaryDirectory() as tmp:
                a = to_mp3(video_id, Path(tmp))
                sent = self.bot.upload("sendAudio", "audio", a["path"], chat_id=chat_id, title=a["title"],
                                       performer=a["performer"], duration=a["duration"])
            file_id = ((sent or {}).get("audio") or {}).get("file_id")
            if file_id:
                cache[video_id] = file_id
                while len(cache) > FILE_CACHE_LIMIT:
                    cache.pop(next(iter(cache)))
                self.st.state_dirty = True
        except Exception as exc:
            print(f"[quick] mp3 {video_id}: {exc}")
            reason = re.sub(r"\x1b\[[0-9;]*m", "", str(exc)).strip().split("\n")[0][:250]
            self.st.send(chat_id, "❌ Bu qo'shiqni audioga aylantirib bo'lmadi. Ro'yxatdan boshqasini tanlang.\n"
                                  f"<code>{esc(reason)}</code>")
        finally:
            if wait:
                self.bot.safe("deleteMessage", chat_id=chat_id, message_id=wait["message_id"])

    # ---------- tugmalar
    def handle_callback(self, cq: dict) -> bool:
        """dl:/pg: tugmalarini bajaradi. Boshqa tugma bo'lsa False qaytaradi."""
        data = cq.get("data") or ""
        action, _, value = data.partition(":")
        if action not in ("dl", "pg"):
            return False
        message = cq.get("message") or {}
        chat_id = (message.get("chat") or {}).get("id")
        if action == "dl":
            self.bot.safe("answerCallbackQuery", callback_query_id=cq["id"], text="⏳ Tayyorlanmoqda...")
            # Bosilgan raqam bo'yicha ro'yxatdagi qatorni olamiz: "Ijrochi - Nomi"
            number = next((b.get("text") for row in (message.get("reply_markup") or {}).get("inline_keyboard", [])
                           for b in row if b.get("callback_data") == data), "")
            text = message.get("caption") or message.get("text") or ""
            line = next((ln[len(number) + 2:] for ln in text.split("\n") if number and ln.startswith(f"{number}. ")), "")
            line = re.sub(r"\s+\d+:\d\d$", "", line).rstrip("…").strip()
            self.send_mp3(chat_id, value, line=line)
            return True

        # pg — xabarning o'zini yangi sahifa bilan almashtiramiz
        self.bot.safe("answerCallbackQuery", callback_query_id=cq["id"])
        old = message.get("caption") or message.get("text") or ""
        first = old.split("\n", 1)[0]
        query = re.sub(r"^\W+\s*", "", first).strip() or first
        header = esc(first)
        try:
            built = self.page(query, header, int(value))
        except Exception as exc:
            print(f"[quick] page: {exc}")
            built = None
        if not built:
            return True
        text, markup = built
        if message.get("photo"):
            self.bot.safe("editMessageCaption", chat_id=chat_id, message_id=message["message_id"],
                          caption=text, parse_mode="HTML", reply_markup=markup)
        else:
            self.st.edit(chat_id, message["message_id"], text, markup)
        return True

    # ---------- qo'shiqni aniqlash
    def recognize(self, msg: dict, media: dict) -> None:
        """Ovozli xabar yoki audio fayl: qaysi qo'shiq ekanini topib, to'liq versiyalar ro'yxatini beradi."""
        chat_id, msg_id = msg["chat"]["id"], msg["message_id"]
        self.bot.safe("sendChatAction", chat_id=chat_id, action="typing")
        found = None
        with tempfile.TemporaryDirectory() as tmp_name:
            tmp = Path(tmp_name)
            try:
                src = self.bot.download(media["file_id"], tmp / "input")
                info = audio.probe(src)
                clip = audio.excerpt(src, tmp / "clip.wav", info, seconds=min(18, max(5, int(info.duration) - 1)))
                found = lookup.shazam(clip) if clip else None
            except (TelegramError, OSError) as exc:
                print(f"[quick] recognize: {exc}")

        if found:
            query = f"{found['artist']} - {found['title']}"
            extra = [x for x in (found.get("album"), found.get("year"), found.get("genre")) if x]
            header = f"🎧 <b>{esc(query)}</b>"
            if extra:
                header += "\n" + esc(" · ".join(str(x) for x in extra))
            self.send_list(chat_id, query, header, msg_id, photo=found.get("cover"))
            return

        hint = " ".join(x for x in ((media.get("performer") or ""), (media.get("title") or "")) if x).strip()
        if not hint and media.get("file_name"):
            hint = Path(media["file_name"]).stem
        if hint:
            self.send_list(chat_id, hint, f"🔍 {esc(hint)}\n😕 Ovozdan aniqlanmadi — fayl nomi bo'yicha qidirdim.",
                           msg_id)
            return
        self.st.send(chat_id, "😕 Qo'shiqni aniqlay olmadim. Musiqa yaqinida 10–15 soniya yozib ko'ring "
                              "yoki qo'shiq nomini yozing.", reply_to=msg_id)
