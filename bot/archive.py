"""Zaxira arxiv: stansiyadagi har bir qo'shiq egasining yopiq Telegram kanaliga ham yuboriladi.

Kanal egasi tomonidan ulanadi: bot kanalga admin qilinadi, so'ng kanaldagi istalgan post botga forward
qilinadi. Har bir ishga tushishda bot hali arxivlanmagan qo'shiqlarni (eski qo'shiqlar ham) bir nechtadan
kanalga yuboradi; qaysilari yuborilgani bot/state.json'da ("archived") saqlanadi.
"""
from __future__ import annotations

import tempfile
import time
from pathlib import Path

import requests

MAX_FILE = 50 * 1024 * 1024  # Bot API orqali yuborish chegarasi
GAP_SECONDS = 3.5  # Telegram: bitta kanalga daqiqasiga ~20 ta xabar


def channel_of(msg: dict) -> dict | None:
    """Forward qilingan postning kanali (yangi va eski Bot API maydonlari)."""
    origin = msg.get("forward_origin") or {}
    if origin.get("type") == "channel" and origin.get("chat"):
        return origin["chat"]
    chat = msg.get("forward_from_chat") or {}
    return chat if chat.get("type") == "channel" else None


def bot_is_admin(station, chat_id: int) -> bool:
    me = station.bot.safe("getMe") or {}
    member = station.bot.safe("getChatMember", chat_id=chat_id, user_id=me.get("id")) or {}
    return member.get("status") in ("administrator", "creator") and member.get("can_post_messages", True)


def connect(station, msg: dict) -> bool:
    """Egasi kanaldan post forward qilsa — shu kanal arxiv bo'ladi. True: xabar shu yerda ishlandi."""
    chat = channel_of(msg)
    if not chat or station.state.get("archive_chat") == chat.get("id"):
        return False
    chat_id = msg["chat"]["id"]
    if not bot_is_admin(station, chat["id"]):
        station.send(chat_id, f"⚠️ «{chat.get('title') or 'Kanal'}» kanalida bot admin emas yoki post "
                              "joylash huquqi yo'q. Botni kanalga admin qilib, postni qayta forward qiling.")
        return True
    station.state["archive_chat"] = chat["id"]
    station.state["archived"] = {}
    station.state_dirty = True
    total = sum(1 for s in station.lib.songs if s.get("src") and not s.get("previewOnly"))
    station.send(chat_id, f"✅ «{chat.get('title') or 'Kanal'}» zaxira arxiv sifatida ulandi.\n\n"
                          f"Saytdagi {total} ta qo'shiq kanalga asta-sekin (har safar bir nechtadan) "
                          "yuboriladi, keyin har bir yangi qo'shiq ham o'zi u yerga tushadi.")
    return True


def group_message(station, msg: dict) -> None:
    """Guruhdagi xabar: egasi «/arxiv» yozsa (yoki botni belgilasa) — shu guruh arxiv bo'ladi."""
    chat = msg.get("chat") or {}
    if msg.get("migrate_to_chat_id") and station.state.get("archive_chat") == chat.get("id"):
        station.state["archive_chat"] = msg["migrate_to_chat_id"]  # guruh supergroup'ga aylandi
        station.state_dirty = True
        return
    text = (msg.get("text") or msg.get("caption") or "").strip().lower()
    me = (station.bot.safe("getMe") or {}).get("username", "").lower()
    asked = text.startswith("/arxiv") or text.startswith("/archive") or (me and f"@{me}" in text)
    user_id = (msg.get("from") or {}).get("id", 0)
    if not asked or not station.authorized(user_id) or station.state.get("archive_chat") == chat.get("id"):
        return
    station.state["archive_chat"] = chat["id"]
    station.state["archived"] = {}
    station.state_dirty = True
    total = sum(1 for s in station.lib.songs if s.get("src") and not s.get("previewOnly"))
    station.send(chat["id"], f"✅ Bu guruh Cavi Music zaxira arxivi sifatida ulandi. Saytdagi {total} ta qo'shiq "
                             "bu yerga asta-sekin yuboriladi, keyin har bir yangi qo'shiq ham o'zi tushadi.")


def _caption(song: dict) -> str:
    head = f"🎵 {song.get('artist') or ''} — {song.get('title') or ''}".strip(" —")
    extra = " · ".join(str(x) for x in (song.get("album"), song.get("year"), song.get("genre")) if x)
    return "\n".join(x for x in (head, f"💿 {extra}" if extra else "", f"#id{song['id']}") if x)[:1000]


def _download(url: str, dest: Path) -> Path | None:
    size = 0
    try:
        with requests.get(url, stream=True, timeout=(15, 120)) as resp:
            resp.raise_for_status()
            with dest.open("wb") as fh:
                for chunk in resp.iter_content(1 << 16):
                    size += len(chunk)
                    if size > MAX_FILE:
                        return None
                    fh.write(chunk)
    except requests.RequestException as exc:
        print(f"[archive] download failed {url}: {exc}")
        return None
    return dest if size else None


def archive_pending(station, budget_seconds: int = 180) -> None:
    """Hali kanalga yuborilmagan (yoki fayli almashgan) qo'shiqlarni yuboradi."""
    chat = station.state.get("archive_chat")
    if not chat:
        return
    done = station.state.setdefault("archived", {})
    deadline = time.monotonic() + budget_seconds
    failures = sent = 0
    for song in list(station.lib.songs):
        src = song.get("src") or ""
        if not src or song.get("previewOnly") or (done.get(song["id"]) or {}).get("src") == src:
            continue
        if time.monotonic() > deadline or failures >= 3:
            break
        url = src if src.startswith("http") else station.site.rstrip("/") + "/" + src
        suffix = Path(src.split("?")[0]).suffix or ".mp3"
        name = f"{song.get('artist') or ''} - {song.get('title') or song['id']}".strip(" -")
        name = "".join(c for c in name if c not in '\\/:*?"<>|')[:120]
        with tempfile.TemporaryDirectory(prefix="cavi-archive-") as tmp:
            path = _download(url, Path(tmp) / f"{name}{suffix}")
            if not path:
                failures += 1
                continue
            res = station.bot.upload("sendAudio", "audio", path, chat_id=chat, caption=_caption(song),
                                     title=song.get("title"), performer=song.get("artist"),
                                     duration=int(song.get("duration") or 0) or None,
                                     disable_notification="true")
        if not res:
            failures += 1
            continue
        done[song["id"]] = {"src": src, "m": res.get("message_id")}
        station.state_dirty = True
        sent += 1
        time.sleep(GAP_SECONDS)
    if sent:
        left = sum(1 for s in station.lib.songs if s.get("src") and not s.get("previewOnly")
                   and (done.get(s["id"]) or {}).get("src") != s.get("src"))
        print(f"[archive] {sent} song(s) sent to the channel, {left} left")
