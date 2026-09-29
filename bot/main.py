"""Music station bot. Run with `python -m bot.main` (GitHub Actions does this on a schedule).

Every run: reads new Telegram messages, identifies and tags uploaded songs,
stores them in library/ and answers the user. The workflow then commits the
library and redeploys the website.
"""
from __future__ import annotations

import hashlib
import hmac
import html
import json
import re
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any

from . import ai, audio, config, lookup
from .covers import save_cover
from .identify import Clues, identify, lyrics_payload
from .library import Library, now_iso, store_audio
from .lookup import lyrics as fetch_lyrics
from .taxonomy import GENRE_UZ, GENRES, LANG_UZ, LANGUAGES, MOOD_UZ, MOODS, canonical_genre
from .telegram_api import Bot, TelegramError
from .textutil import norm, similarity, split_artist_title, split_artists

SETUP_VERSION = "3"
AUDIO_EXT = {".mp3", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wav", ".wma", ".aif", ".aiff",
             ".ape", ".alac", ".amr", ".mka", ".weba"}
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".3gp", ".m4v"}
TARGET_LUFS = -14.0  # same loudness target as the big streaming services

def esc(text: Any) -> str:
    return html.escape(str(text), quote=False)


def fmt_duration(seconds: float) -> str:
    seconds = int(round(seconds or 0))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


class Station:
    def __init__(self) -> None:
        self.bot = Bot(config.TOKEN)
        self.lib = Library()
        self.state: dict[str, Any] = json.loads(config.STATE_FILE.read_text()) if config.STATE_FILE.exists() else {}
        self.state_dirty = False
        self.site = config.SITE_URL

    # ================================================================== plumbing
    def save(self) -> None:
        self.lib.save()
        if self.state_dirty:
            config.STATE_FILE.write_text(json.dumps(self.state, indent=1) + "\n")
            self.state_dirty = False

    def app_button(self, text: str = "🎧 Stansiyani ochish", route: str = "") -> dict | None:
        if not self.site.startswith("https://"):
            return None
        return {"text": text, "web_app": {"url": self.site + (f"#/{route}" if route else "")}}

    def keyboard(self, *rows: list[dict | None]) -> dict | None:
        clean_rows = [[b for b in row if b] for row in rows]
        clean_rows = [r for r in clean_rows if r]
        return {"inline_keyboard": clean_rows} if clean_rows else None

    def send(self, chat_id: int, text: str, reply_to: int | None = None, markup: dict | None = None) -> dict | None:
        params: dict[str, Any] = {"chat_id": chat_id, "text": text, "parse_mode": "HTML",
                                  "link_preview_options": {"is_disabled": True}, "reply_markup": markup}
        if reply_to:
            params["reply_parameters"] = {"message_id": reply_to, "allow_sending_without_reply": True}
        return self.bot.safe("sendMessage", **params)

    def edit(self, chat_id: int, message_id: int, text: str, markup: dict | None = None) -> None:
        self.bot.safe("editMessageText", chat_id=chat_id, message_id=message_id, text=text, parse_mode="HTML",
                      link_preview_options={"is_disabled": True}, reply_markup=markup)

    def setup(self) -> None:
        """Registers commands, menu button (opens the mini app) and descriptions — once per site URL."""
        signature = hashlib.sha1(f"{SETUP_VERSION}|{self.site}|{config.APP_NAME}".encode()).hexdigest()
        if self.state.get("setup") == signature:
            return
        self.bot.safe("setMyCommands", commands=[
            {"command": "start", "description": "Boshlash"},
            {"command": "app", "description": "Stansiyani ochish"},
            {"command": "list", "description": "Oxirgi qo'shilgan qo'shiqlar"},
            {"command": "stats", "description": "Kutubxona statistikasi"},
            {"command": "edit", "description": "Qo'shiq ma'lumotini tuzatish (javob tariqasida)"},
            {"command": "delete", "description": "Qo'shiqni o'chirish (javob tariqasida)"},
            {"command": "help", "description": "Yordam"},
        ])
        if self.site.startswith("https://"):
            self.bot.safe("setChatMenuButton", menu_button={
                "type": "web_app", "text": "🎧 Musiqa", "web_app": {"url": self.site}})
        self.bot.safe("setMyShortDescription", short_description=(
            f"{config.APP_NAME} — shaxsiy musiqa stansiyasi. Qo'shiq yuboring: AI uni aniqlab, saytga joylaydi."))
        self.bot.safe("setMyDescription", description=(
            "🎧 Shaxsiy musiqa stansiyangiz.\n\nQo'shiq (mp3, m4a, flac, ogg, wav) yoki video klip yuboring — "
            "bot nomini, ijrochisini, albomini, janrini, kayfiyatini, muqovasi va qo'shiq matnini avtomatik topadi "
            "va uni sayt/mini ilovaga qo'shadi. Tavsiyalar, qidiruv, sevimlilar va tinglashlar soni — hammasi bor."))
        self.state["setup"] = signature
        self.state_dirty = True

    # ================================================================== access
    def authorized(self, user_id: int) -> bool:
        if config.PUBLIC_UPLOADS:
            return True
        if config.OWNER_IDS:
            return user_id in config.OWNER_IDS
        digest = hmac.new(config.TOKEN.encode(), str(user_id).encode(), hashlib.sha256).hexdigest()
        owner = self.state.get("owner")
        if not owner:
            # First person to talk to the bot becomes the owner of the station.
            self.state["owner"] = digest
            self.state_dirty = True
            return True
        return hmac.compare_digest(owner, digest)

    # ================================================================== updates
    def handle_update(self, update: dict) -> None:
        if "callback_query" in update:
            self.handle_callback(update["callback_query"])
            return
        msg = update.get("message")
        if not msg or msg.get("chat", {}).get("type") != "private":
            return
        user_id = (msg.get("from") or {}).get("id", 0)
        text = (msg.get("text") or "").strip()
        chat_id = msg["chat"]["id"]

        if text.startswith("/"):
            command, _, arg = text.partition(" ")
            command = command[1:].split("@")[0].lower()
            if command in ("start", "help", "app"):
                is_owner = self.authorized(user_id)
                self.cmd_start(chat_id, command, is_owner)
                return
            if not self.authorized(user_id):
                self.send(chat_id, "🔒 Bu buyruq faqat stansiya egasi uchun.")
                return
            handler = getattr(self, f"cmd_{command}", None)
            if handler:
                handler(msg, arg.strip())
            else:
                self.send(chat_id, "Bunday buyruq yo'q. /help")
            return

        media = self.pick_media(msg)
        if media and media[0] == "voice":
            self.recognize_voice(msg, media[1])  # "what song is this?" — anyone may ask
            return
        if media:
            if not self.authorized(user_id):
                self.send(chat_id, "🔒 Bu shaxsiy musiqa stansiyasi — qo'shiq qo'shish faqat egasiga ruxsat etilgan.",
                          reply_to=msg["message_id"], markup=self.keyboard([self.app_button("🎧 Tinglash")]))
                return
            self.handle_song(msg, *media)
            return

        if msg.get("photo") and msg.get("reply_to_message") and self.authorized(user_id):
            self.set_cover_from_photo(msg)
            return

        if text:
            self.search(chat_id, text, msg["message_id"])
            return
        self.send(chat_id, "🎵 Menga audio fayl yoki video klip yuboring — men uni stansiyaga qo'shaman.")

    @staticmethod
    def pick_media(msg: dict) -> tuple[str, dict] | None:
        if msg.get("audio"):
            return "audio", msg["audio"]
        doc = msg.get("document")
        if doc:
            name = (doc.get("file_name") or "").lower()
            mime = (doc.get("mime_type") or "").lower()
            ext = Path(name).suffix
            if mime.startswith("audio/") or ext in AUDIO_EXT:
                return "document", doc
            if mime.startswith("video/") or ext in VIDEO_EXT:
                return "video", doc
        if msg.get("video"):
            return "video", msg["video"]
        if msg.get("voice"):
            return "voice", msg["voice"]
        return None

    # ================================================================== songs
    def recognize_voice(self, msg: dict, voice: dict) -> None:
        """A voice note recorded near a speaker: identify the song (like Shazam), don't store the recording."""
        chat_id, msg_id = msg["chat"]["id"], msg["message_id"]
        self.bot.safe("sendChatAction", chat_id=chat_id, action="typing")
        found = None
        with tempfile.TemporaryDirectory() as tmp_name:
            tmp = Path(tmp_name)
            try:
                src = self.bot.download(voice["file_id"], tmp / "voice.ogg")
                info = audio.probe(src)
                clip = audio.excerpt(src, tmp / "clip.wav", info, seconds=min(18, max(5, int(info.duration) - 1)))
                found = lookup.shazam(clip) if clip else None
            except (TelegramError, OSError) as exc:
                print(f"[voice] {exc}")
        if not found:
            self.send(chat_id, "🎙 Qo'shiqni aniqlay olmadim. Musiqa yaqinida 10–15 soniya yozib ko'ring "
                               "yoki qo'shiqning o'zini (audio fayl) yuboring.", reply_to=msg_id)
            return
        in_lib = next((s for s in self.lib.songs
                       if lookup.same_song(s["title"], s["artist"], found["title"], found["artist"])), None)
        text = [f"🎙 <b>Topildi:</b> {esc(found['artist'])} — <b>{esc(found['title'])}</b>"]
        if found.get("album"):
            text.append(f"💿 {esc(found['album'])}" + (f" · {found['year']}" if found.get("year") else ""))
        if in_lib:
            text.append("\n✅ Bu qo'shiq stansiyangizda bor.")
            markup = self.song_markup(in_lib)
        else:
            text.append("\nStansiyaga qo'shish uchun qo'shiqning audio faylini yuboring.")
            markup = None
        self.send(chat_id, "\n".join(text), reply_to=msg_id, markup=markup)

    def handle_song(self, msg: dict, kind: str, media: dict) -> None:
        chat_id, msg_id = msg["chat"]["id"], msg["message_id"]
        file_key = hashlib.sha1(media["file_unique_id"].encode()).hexdigest()[:16]
        existing = self.lib.by_file(file_key)
        if existing:
            self.remember_message(existing, msg_id)
            self.send(chat_id, "ℹ️ Bu fayl allaqachon kutubxonada bor:\n\n" + self.card(existing),
                      reply_to=msg_id, markup=self.song_markup(existing))
            return
        size = media.get("file_size") or 0
        if size > config.TELEGRAM_MAX_DOWNLOAD:
            self.send(chat_id, f"⚠️ Fayl juda katta ({size / 1048576:.1f} MB). Telegram botlari 20 MB gacha "
                               "fayllarni yuklab ola oladi. Iltimos, siqilgan mp3 (masalan 320 kbps) yuboring.",
                      reply_to=msg_id)
            return

        status = self.send(chat_id, "⏳ Qabul qilindi. Yuklab olinmoqda…", reply_to=msg_id)
        status_id = (status or {}).get("message_id")
        last_text = [""]

        def progress(text: str) -> None:
            if status_id and text != last_text[0]:
                last_text[0] = text
                self.edit(chat_id, status_id, text)
            self.bot.safe("sendChatAction", chat_id=chat_id, action="typing")

        try:
            song, duplicate = self.import_song(msg, kind, media, file_key, progress)
        except Exception as exc:
            traceback.print_exc()
            text = f"❌ Qo'shiqni qo'shib bo'lmadi: {esc(str(exc)[:300])}"
            if status_id:
                self.edit(chat_id, status_id, text)
            else:
                self.send(chat_id, text, reply_to=msg_id)
            return
        if duplicate:
            text = "ℹ️ Bu qo'shiq allaqachon kutubxonada bor:\n\n" + self.card(song)
        else:
            text = "✅ <b>Stansiyaga qo'shildi!</b>\n\n" + self.card(song) + \
                   "\n\n<i>Sayt va mini ilovada 1–3 daqiqada paydo bo'ladi.</i>"
        if status_id:
            self.remember_message(song, status_id)
            self.edit(chat_id, status_id, text, self.song_markup(song))
        else:
            self.send(chat_id, text, reply_to=msg_id, markup=self.song_markup(song))

    def import_song(self, msg: dict, kind: str, media: dict, file_key: str, progress) -> tuple[dict, bool]:
        """Downloads, identifies and stores a song. Returns (song, is_duplicate)."""
        msg_id = msg["message_id"]
        with tempfile.TemporaryDirectory() as tmp_name:
            tmp = Path(tmp_name)
            ext = Path(media.get("file_name") or "").suffix.lower() or {"voice": ".ogg", "video": ".mp4"}.get(kind, ".mp3")
            src = self.bot.download(media["file_id"], tmp / f"input{ext}")
            info = audio.probe(src)
            if not info.has_audio:
                raise RuntimeError("faylda audio topilmadi")

            thumb = None
            thumb_meta = media.get("thumbnail") or media.get("thumb")
            if thumb_meta:
                try:
                    thumb = self.bot.download(thumb_meta["file_id"], tmp / "thumb.jpg")
                except TelegramError:
                    thumb = None
            clues = Clues(
                tg_performer=media.get("performer") or "",
                tg_title=media.get("title") or "",
                file_name=media.get("file_name") or "",
                caption=msg.get("caption") or "",
                thumb=thumb,
            )
            result = identify(src, info, clues, tmp, progress)
            meta = result.meta

            dup = self.lib.duplicate_of(meta["title"], meta["artist"], info.duration)
            if dup:
                self.remember_message(dup, msg_id)
                return dup, True

            song_id = hashlib.sha1(media["file_unique_id"].encode()).hexdigest()[:10]
            progress("💾 Saqlanmoqda…")
            final, mime = audio.encode(src, tmp / song_id, info, {
                "title": meta["title"], "artist": meta["artist"], "album": meta.get("album") or "",
                "date": str(meta.get("year") or ""), "genre": meta.get("genre") or "",
            })
            lufs = audio.loudness(final)
            src_url, storage = store_audio(self.lib, final, song_id, mime)

            cover_rel, color = None, None
            if result.cover:
                color = save_cover(result.cover, config.COVERS_DIR / f"{song_id}.jpg")
                if color:
                    cover_rel = f"library/covers/{song_id}.jpg"

            lyrics_kind, lyrics_data = lyrics_payload(result.lyrics)
            if lyrics_data:
                config.LYRICS_DIR.mkdir(parents=True, exist_ok=True)
                (config.LYRICS_DIR / f"{song_id}.json").write_text(json.dumps(lyrics_data, ensure_ascii=False))

            self.lib.ensure_artist_image(meta["artists"][0], result.artist_picture)

            song = {
                "id": song_id,
                "title": meta["title"],
                "artist": meta["artist"],
                "artists": meta["artists"],
                "album": meta.get("album"),
                "year": meta.get("year"),
                "genre": meta.get("genre", "Other"),
                "subgenre": meta.get("subgenre"),
                "moods": meta.get("moods", []),
                "language": meta.get("language", "other"),
                "energy": meta.get("energy", 0.5),
                "danceability": meta.get("danceability", 0.5),
                "bpm": meta.get("bpm"),
                "tags": meta.get("tags", []),
                "description": meta.get("description"),
                "explicit": meta.get("explicit", False),
                "duration": round(info.duration, 2),
                "src": src_url,
                "mime": mime,
                "size": final.stat().st_size,
                "storage": storage,
                "cover": cover_rel,
                "color": color,
                "lyrics": lyrics_kind,
                "lufs": round(lufs, 1) if lufs is not None else None,
                "gain": round(max(-12.0, min(0.0, TARGET_LUFS - lufs)), 1) if lufs is not None else 0,
                "confidence": meta.get("confidence"),
                "sources": result.sources,
                "via": "video" if kind == "video" else kind,
                "fileKey": file_key,
                "tg": {"msgs": [msg_id]},
                "addedAt": now_iso(),
            }
            self.lib.add(song)
            self.save()  # persist right away, so a crash later can't lose it
            print(f"[station] added {song_id}: {song['artist']} - {song['title']} ({', '.join(result.sources)})")
            return song, False

    def remember_message(self, song: dict, message_id: int) -> None:
        msgs = song.setdefault("tg", {}).setdefault("msgs", [])
        if message_id not in msgs:
            msgs.append(message_id)
            del msgs[:-20]
            self.lib.dirty = True

    def card(self, s: dict) -> str:
        lines = [f"🎵 <b>{esc(s['title'])}</b>", f"👤 {esc(s['artist'])}"]
        album_bits = [esc(x) for x in (s.get("album"), str(s["year"]) if s.get("year") else None) if x]
        if album_bits:
            lines.append("💿 " + " · ".join(album_bits))
        genre = GENRE_UZ.get(s.get("genre", ""), s.get("genre", ""))
        moods = ", ".join(MOOD_UZ.get(m, m) for m in s.get("moods", []))
        lines.append("🎼 " + genre + (f" · {moods}" if moods else ""))
        lines.append(f"🌐 {LANG_UZ.get(s.get('language', ''), '—')} · ⏱ {fmt_duration(s.get('duration', 0))}"
                     + (f" · {s['bpm']} BPM" if s.get("bpm") else ""))
        lyr = {"synced": "bor (sinxron karaoke)", "plain": "bor"}.get(s.get("lyrics") or "", "topilmadi")
        lines.append(f"📝 Qo'shiq matni: {lyr}")
        if s.get("tags"):
            hashtags = [re.sub(r"[^\w]+", "_", t).strip("_") for t in s["tags"][:6]]
            lines.append("🏷 " + " ".join(f"#{esc(t)}" for t in hashtags if t))
        src = {"shazam": "Shazam", "itunes": "iTunes", "deezer": "Deezer", "ai": "AI"}
        found = " + ".join(src[x] for x in s.get("sources", []) if x in src) or "fayl ma'lumotlari"
        conf = s.get("confidence")
        lines.append(f"🤖 Aniqlandi: {found}" + (f" (ishonch {round(conf * 100)}%)" if conf is not None else ""))
        if s.get("description"):
            lines.append(f"\n<i>{esc(s['description'])}</i>")
        lines.append(f"\n🆔 <code>{s['id']}</code>")
        return "\n".join(lines)

    def song_markup(self, song: dict) -> dict | None:
        return self.keyboard(
            [self.app_button("▶️ Tinglash", f"song/{song['id']}"),
             {"text": "🗑 O'chirish", "callback_data": f"del:{song['id']}"}])

    # ================================================================== reply targets
    def target_song(self, msg: dict, arg: str) -> dict | None:
        token = arg.split()[0] if arg else ""
        if re.fullmatch(r"[0-9a-f]{10}", token or ""):
            return self.lib.get(token)
        reply = msg.get("reply_to_message")
        if not reply:
            return None
        found = self.lib.by_message(reply["message_id"])
        if found:
            return found
        m = re.search(r"\b([0-9a-f]{10})\b", (reply.get("text") or "") + (reply.get("caption") or ""))
        return self.lib.get(m.group(1)) if m else None

    # ================================================================== commands
    def cmd_start(self, chat_id: int, command: str, is_owner: bool) -> None:
        count = len(self.lib.songs)
        if command == "app":
            self.send(chat_id, f"🎧 <b>{esc(config.APP_NAME)}</b> — {count} ta qo'shiq",
                      markup=self.keyboard([self.app_button()]))
            return
        text = [f"🎧 <b>{esc(config.APP_NAME)}</b> — shaxsiy musiqa stansiyangiz!", ""]
        if is_owner:
            text += [
                "Menga qo'shiq yuboring (mp3, m4a, flac, ogg, wav) yoki video klip — men uni avtomatik aniqlayman:",
                "• nomi va ijrochisi (Shazam + katalog + AI)",
                "• albom, yil, janr, kayfiyat, til",
                "• muqova rasmi va qo'shiq matni (karaoke)",
                "• ovoz balandligi normallashtiriladi",
                "",
                "Keyin qo'shiq saytda va mini ilovada paydo bo'ladi: tavsiyalar, qidiruv, sevimlilar va tinglashlar soni.",
                "",
                "<b>Buyruqlar</b>",
                "/list — oxirgi qo'shiqlar",
                "/stats — statistika",
                "/edit Ijrochi - Nomi — ma'lumotni tuzatish (qo'shiq xabariga javob qilib)",
                "/edit genre=Pop mood=romantic lang=uz year=2020 album=...",
                "/delete — qo'shiqni o'chirish (javob qilib)",
                "🖼 Qo'shiq xabariga rasm bilan javob bersangiz — muqova almashadi",
                "🔎 Oddiy matn yozsangiz — kutubxonadan qidiraman",
                "🎙 Ovozli xabar (musiqa yaqinida yozilgan) — qanday qo'shiqligini aniqlayman",
            ]
            if not ai.enabled():
                text += ["", "💡 <i>AI teglash o'chiq: ANTHROPIC_API_KEY sirini qo'shsangiz yoqiladi.</i>"]
        else:
            text += ["Bu shaxsiy stansiya. Qo'shiqlarni tinglash uchun tugmani bosing."]
        text += ["", f"📚 Kutubxonada: <b>{count}</b> ta qo'shiq"]
        self.send(chat_id, "\n".join(text), markup=self.keyboard([self.app_button()]))

    def cmd_list(self, msg: dict, arg: str) -> None:
        chat_id = msg["chat"]["id"]
        if not self.lib.songs:
            self.send(chat_id, "Kutubxona hozircha bo'sh. Qo'shiq yuboring! 🎵")
            return
        lines = ["🆕 <b>Oxirgi qo'shiqlar</b>", ""]
        for i, s in enumerate(self.lib.songs[:15], 1):
            lines.append(f"{i}. <b>{esc(s['artist'])}</b> — {esc(s['title'])} <code>{s['id']}</code>")
        self.send(chat_id, "\n".join(lines), markup=self.keyboard([self.app_button()]))

    def cmd_stats(self, msg: dict, arg: str) -> None:
        songs = self.lib.songs
        artists: dict[str, int] = {}
        genres: dict[str, int] = {}
        for s in songs:
            for a in s.get("artists", []):
                artists[a] = artists.get(a, 0) + 1
            genres[s.get("genre", "Other")] = genres.get(s.get("genre", "Other"), 0) + 1
        size = sum(s.get("size", 0) for s in songs)
        lines = [
            "📊 <b>Kutubxona statistikasi</b>", "",
            f"🎵 Qo'shiqlar: <b>{len(songs)}</b>",
            f"👤 Ijrochilar: <b>{len(artists)}</b>",
            f"⏱ Umumiy davomiylik: <b>{fmt_duration(self.lib.total_duration())}</b>",
            f"💾 Hajm: <b>{size / 1048576:.1f} MB</b> (saytda: {self.lib.pages_audio_bytes() / 1048576:.0f} MB)",
            f"📝 Matnli qo'shiqlar: <b>{sum(1 for s in songs if s.get('lyrics'))}</b>",
            f"🤖 AI: <b>{'yoqilgan' if ai.enabled() else 'o‘chiq'}</b>",
        ]
        if artists:
            lines += ["", "<b>Top ijrochilar</b>"]
            lines += [f"• {esc(a)} — {n}" for a, n in sorted(artists.items(), key=lambda x: -x[1])[:7]]
        if genres:
            lines += ["", "<b>Janrlar</b>"]
            lines += [f"• {GENRE_UZ.get(g, g)} — {n}" for g, n in sorted(genres.items(), key=lambda x: -x[1])[:7]]
        lines += ["", "<i>Tinglashlar soni saytda (Kutubxona → Statistika) ko'rinadi.</i>"]
        self.send(msg["chat"]["id"], "\n".join(lines), markup=self.keyboard([self.app_button()]))

    def cmd_delete(self, msg: dict, arg: str) -> None:
        song = self.target_song(msg, arg)
        if not song:
            self.send(msg["chat"]["id"], "Qaysi qo'shiq? Qo'shiq xabariga javob qilib /delete yozing "
                                         "yoki /delete <code>ID</code>.")
            return
        self.lib.remove(song)
        self.save()
        self.send(msg["chat"]["id"], f"🗑 O'chirildi: <b>{esc(song['artist'])} — {esc(song['title'])}</b>")

    def cmd_edit(self, msg: dict, arg: str) -> None:
        chat_id = msg["chat"]["id"]
        explicit = re.match(r"^([0-9a-f]{10})\b\s*(.*)$", arg, re.S)
        if explicit:
            song, arg = self.lib.get(explicit.group(1)), explicit.group(2).strip()
        else:
            song = self.target_song(msg, "")
        if not song or not arg:
            self.send(chat_id, "Qo'shiq xabariga javob qilib yozing:\n<code>/edit Ijrochi - Nomi</code>\n"
                               "yoki <code>/edit title=... artist=... album=... year=2020 genre=Pop "
                               "mood=romantic,sad lang=uz</code>")
            return
        fields: dict[str, Any] = {}
        pairs = re.findall(r"(\w+)=(.*?)(?=\s+\w+=|$)", arg)
        if not pairs:
            artist, title = split_artist_title(arg)
            if artist:
                fields["artists"] = split_artists(artist)
            fields["title"] = title
        for key, value in pairs:
            key, value = key.lower(), value.strip()
            if key in ("title", "nom", "nomi"):
                fields["title"] = value
            elif key in ("artist", "ijrochi", "artists"):
                fields["artists"] = split_artists(value)
            elif key in ("album", "albom"):
                fields["album"] = value or None
            elif key in ("year", "yil") and value.isdigit():
                fields["year"] = int(value)
            elif key in ("genre", "janr"):
                rev = {v.lower(): k for k, v in GENRE_UZ.items()}
                fields["genre"] = rev.get(value.lower()) or next(
                    (g for g in GENRES if g.lower() == value.lower()), canonical_genre(value))
            elif key in ("mood", "moods", "kayfiyat"):
                rev = {v: k for k, v in MOOD_UZ.items()}
                moods = [rev.get(m.strip().lower(), m.strip().lower()) for m in value.split(",")]
                fields["moods"] = [m for m in moods if m in MOODS][:3]
            elif key in ("lang", "language", "til") and value.lower() in LANGUAGES:
                fields["language"] = value.lower()
            elif key in ("tags", "teg"):
                fields["tags"] = [t.strip().lower() for t in value.split(",") if t.strip()][:8]
        if not fields:
            self.send(chat_id, "Hech narsa o'zgarmadi — formatni tekshiring. /help")
            return
        if "artists" in fields:
            fields["artist"] = ", ".join(fields["artists"])
        renamed = ("title" in fields and similarity(fields["title"], song["title"]) < 0.9) or \
                  ("artist" in fields and similarity(fields["artist"], song["artist"]) < 0.9)
        self.lib.update(song, **fields, confidence=1.0)
        if renamed and config.LYRICS_ENABLED:
            kind, data = lyrics_payload(fetch_lyrics(song["title"], song["artists"][0], song.get("album") or "",
                                                     song.get("duration", 0)))
            if data:
                (config.LYRICS_DIR / f"{song['id']}.json").write_text(json.dumps(data, ensure_ascii=False))
                song["lyrics"] = kind
        self.save()
        self.send(chat_id, "✏️ Yangilandi:\n\n" + self.card(song), markup=self.song_markup(song))

    def set_cover_from_photo(self, msg: dict) -> None:
        song = self.target_song(msg, "")
        if not song:
            self.send(msg["chat"]["id"], "Rasmni qo'shiq xabariga javob qilib yuboring.")
            return
        photo = max(msg["photo"], key=lambda p: p.get("file_size", 0))
        with tempfile.TemporaryDirectory() as tmp:
            path = self.bot.download(photo["file_id"], Path(tmp) / "cover.jpg")
            color = save_cover(path.read_bytes(), config.COVERS_DIR / f"{song['id']}.jpg")
        if not color:
            self.send(msg["chat"]["id"], "Rasmni o'qib bo'lmadi.")
            return
        self.lib.update(song, cover=f"library/covers/{song['id']}.jpg", color=color, coverV=int(time.time()))
        self.save()
        self.send(msg["chat"]["id"], f"🖼 Muqova yangilandi: <b>{esc(song['title'])}</b>")

    def search(self, chat_id: int, query: str, reply_to: int) -> None:
        q = norm(query)
        scored = []
        for s in self.lib.songs:
            hay = norm(f"{s['artist']} {s['title']} {s.get('album') or ''}")
            score = 1.0 if q in hay else max(similarity(query, s["title"]), similarity(query, s["artist"]))
            if score >= 0.6:
                scored.append((score, s))
        scored.sort(key=lambda x: -x[0])
        if not scored:
            self.send(chat_id, "🔎 Kutubxonadan topilmadi. Qo'shiq qo'shish uchun audio fayl yuboring.",
                      reply_to=reply_to)
            return
        top = [s for _, s in scored[:8]]
        lines = [f"🔎 Topildi: {len(scored)} ta", ""]
        lines += [f"• <b>{esc(s['artist'])}</b> — {esc(s['title'])} <code>{s['id']}</code>" for s in top]
        rows = [[self.app_button(f"▶️ {s['artist']} — {s['title']}"[:60], f"song/{s['id']}")] for s in top]
        self.send(chat_id, "\n".join(lines), reply_to=reply_to, markup=self.keyboard(*rows))

    # ================================================================== callbacks
    def handle_callback(self, cq: dict) -> None:
        data = cq.get("data") or ""
        user_id = (cq.get("from") or {}).get("id", 0)
        message = cq.get("message") or {}
        chat_id, message_id = (message.get("chat") or {}).get("id"), message.get("message_id")
        if not self.authorized(user_id):
            self.bot.safe("answerCallbackQuery", callback_query_id=cq["id"], text="🔒 Faqat egasi uchun")
            return
        action, _, song_id = data.partition(":")
        song = self.lib.get(song_id)
        if not song:
            self.bot.safe("answerCallbackQuery", callback_query_id=cq["id"], text="Qo'shiq topilmadi")
            return
        if action == "del":
            self.bot.safe("answerCallbackQuery", callback_query_id=cq["id"])
            self.edit(chat_id, message_id, f"🗑 <b>{esc(song['artist'])} — {esc(song['title'])}</b>\n\n"
                                           "Rostdan ham o'chirilsinmi?",
                      self.keyboard([{"text": "✅ Ha, o'chirish", "callback_data": f"delok:{song_id}"},
                                     {"text": "↩️ Bekor qilish", "callback_data": f"back:{song_id}"}]))
        elif action == "delok":
            self.lib.remove(song)
            self.save()
            self.bot.safe("answerCallbackQuery", callback_query_id=cq["id"], text="O'chirildi")
            self.edit(chat_id, message_id, f"🗑 O'chirildi: <s>{esc(song['artist'])} — {esc(song['title'])}</s>")
        elif action == "back":
            self.bot.safe("answerCallbackQuery", callback_query_id=cq["id"])
            self.edit(chat_id, message_id, self.card(song), self.song_markup(song))
        else:
            self.bot.safe("answerCallbackQuery", callback_query_id=cq["id"])

    # ================================================================== main loop
    def get_updates(self, offset: int | None, timeout: int) -> list[dict]:
        try:
            return self.bot.call("getUpdates", timeout=timeout, offset=offset,
                                 allowed_updates=["message", "callback_query"])
        except TelegramError as exc:
            if exc.code == 409:  # a webhook is set -> switch to polling
                self.bot.safe("deleteWebhook")
                return []
            raise

    def run(self) -> None:
        started = time.monotonic()
        deadline = started + config.MAX_RUNTIME_SECONDS
        listen_until = started + config.LISTEN_SECONDS
        self.setup()
        offset: int | None = None
        handled = 0
        while time.monotonic() < deadline:
            wait = int(max(0, min(25, listen_until - time.monotonic())))
            try:
                updates = self.get_updates(offset, wait)
            except TelegramError as exc:
                print(f"[station] getUpdates failed: {exc}")
                break
            if not updates:
                if time.monotonic() >= listen_until:
                    break
                continue
            for update in updates:
                try:
                    self.handle_update(update)
                except Exception:
                    traceback.print_exc()
                offset = update["update_id"] + 1
                handled += 1
                self.save()
                if time.monotonic() > deadline + 120:
                    break
            # keep listening a bit longer while the user is active
            listen_until = min(deadline, time.monotonic() + config.LISTEN_SECONDS)
        if offset is not None:
            self.bot.safe("getUpdates", offset=offset, timeout=0, limit=1)  # confirm processed updates
        self.save()
        print(f"[station] handled {handled} update(s); library has {len(self.lib.songs)} song(s)")


def main() -> int:
    if not config.TOKEN:
        print("::warning::TELEGRAM_BOT_TOKEN secret is not set — bot step skipped.")
        return 0
    Station().run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
