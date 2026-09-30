"""Search YuklaydiBot and forward audio to Cavi, with bounded outstanding work.

Run from the repository root. Credentials stay in environment/local session files.
No source audio is downloaded. Telegram Web sessions are never accessed.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import os
from pathlib import Path
import time


def save(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def numeric_buttons(message):
    return [b.text for row in (message.buttons or []) for b in row if b.text.isdigit()]


def signature(message):
    return message.raw_text, tuple(b.text for row in (message.buttons or []) for b in row)


def outcome(text):
    text = text.casefold()
    if "stansiyaga qo'shildi" in text:
        return "added"
    if "takroriy" in text or "allaqachon" in text:
        return "duplicate"
    if "❌" in text or "⚠️" in text:
        return "failed"
    if "qo'shaymi" in text or "qo‘shaymi" in text:
        return "review"
    return None


class Importer:
    def __init__(self, client, source, target, args, state):
        self.client, self.source, self.target = client, source, target
        self.args, self.state = args, state

    def checkpoint(self):
        save(self.args.state, self.state)

    async def call(self, action):
        from telethon.errors import FloodWaitError
        while True:
            try:
                return await action()
            except FloodWaitError as exc:
                print(f"Telegram kutish talab qildi: {exc.seconds} soniya", flush=True)
                await asyncio.sleep(exc.seconds + 1)

    async def latest(self, peer):
        messages = await self.call(lambda: self.client.get_messages(peer, limit=1))
        return messages[0].id if messages else 0

    async def wait_source(self, after, predicate, message_id=None):
        deadline = time.monotonic() + self.args.source_timeout
        while time.monotonic() < deadline:
            if message_id:
                msg = await self.call(lambda: self.client.get_messages(self.source, ids=message_id))
                if msg and predicate(msg):
                    return msg
            else:
                messages = await self.call(lambda: self.client.get_messages(
                    self.source, limit=30, min_id=after))
                for msg in reversed(messages):
                    if not msg.out and predicate(msg):
                        return msg
            await asyncio.sleep(3)
        raise TimeoutError("YuklaydiBot javobi kelmadi. Holat saqlandi; qayta ishga tushiring.")

    async def refresh_target(self):
        # min_id is the oldest unacknowledged forward, so replies cannot age out
        # of a fixed recent-message window during a slow GitHub Actions run.
        pending = [x for x in self.state["tracks"].values() if x["status"] == "sent"]
        if not pending:
            return
        by_id = {x["target_id"]: x for x in pending}
        async for msg in self.client.iter_messages(self.target, min_id=min(by_id)):
            reply = getattr(msg, "reply_to_msg_id", None)
            if not msg.out and reply in by_id:
                result = outcome(msg.raw_text or "")
                if result:
                    by_id[reply]["status"] = result
        self.checkpoint()

    async def drain(self, all_pending=False):
        deadline = time.monotonic() + self.args.target_timeout
        while True:
            await self.refresh_target()
            count = sum(x["status"] == "sent" for x in self.state["tracks"].values())
            if count == 0 or (not all_pending and count < self.args.max_pending):
                return
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Cavi botidan {count} audio javobi kutilmoqda. "
                                   "Yangi yuborish to'xtadi; holat saqlandi.")
            print(f"Cavi: {count} audio qayta ishlanishi kutilmoqda", flush=True)
            await asyncio.sleep(15)

    async def forward(self, msg, artist):
        key = str(msg.document.id)
        old = self.state["tracks"].get(key)
        if old and old["status"] != "ready":
            return
        if len(self.state["tracks"]) >= self.args.limit and not old:
            return
        await self.drain()
        item = old or {"source_id": msg.id, "artist": artist, "status": "ready"}
        self.state["tracks"][key] = item
        # Record before sending: on an ambiguous network failure, never blindly
        # resend a message whose delivery is unknown.
        item["status"] = "sending"
        self.checkpoint()
        try:
            sent = await self.call(lambda: self.client.forward_messages(self.target, msg))
        except Exception:
            print("Forward natijasi noma'lum. Qayta yuborishdan oldin qabul qiluvchi tekshiriladi.")
            raise
        item.update(status="sent", target_id=sent.id)
        self.checkpoint()
        print(f"Yuborildi: {artist} · jami {len(self.state['tracks'])}", flush=True)
        await asyncio.sleep(self.args.delay)

    async def recover(self):
        # Crash between forwarding and checkpointing: reconcile by Telegram
        # document ID. If not found, stop instead of possibly sending twice.
        unknown = {k: v for k, v in self.state["tracks"].items() if v["status"] == "sending"}
        if unknown:
            async for msg in self.client.iter_messages(self.target, limit=2000):
                if msg.out and msg.document and str(msg.document.id) in unknown:
                    unknown[str(msg.document.id)].update(status="sent", target_id=msg.id)
            self.checkpoint()
            if any(x["status"] == "sending" for x in unknown.values()):
                raise RuntimeError("Noma'lum forward topildi. Cavi chatini tekshiring; "
                                   "state.json'dagi shu yozuvni tekshirmasdan qayta yubormang.")
        await self.drain()

    async def run(self, artists):
        await self.recover()
        for artist in artists:
            if artist in self.state["completed_artists"]:
                continue
            cursor = self.state.get("cursor")
            if cursor and cursor["artist"] != artist:
                raise RuntimeError("Artist ro'yxati o'zgargan. Avval oldingi ro'yxat bilan davom eting.")
            if not cursor:
                if len(self.state["tracks"]) >= self.args.limit:
                    break
                baseline = await self.latest(self.source)
                await self.call(lambda: self.client.send_message(self.source, artist))
                result = await self.wait_source(baseline, lambda m: bool(numeric_buttons(m)))
                cursor = {"artist": artist, "result_id": result.id, "page": 1,
                          "done_buttons": [], "request": None, "advance": None}
                self.state["cursor"] = cursor
                self.checkpoint()
            result = await self.call(lambda: self.client.get_messages(self.source, ids=cursor["result_id"]))
            if not result or not numeric_buttons(result):
                raise RuntimeError("Saqlangan qidiruv menyusi topilmadi; cursor'ni tekshiring.")
            while True:
                if cursor.get("advance"):
                    before = cursor["advance"]
                    result = await self.wait_source(0, lambda m: signature(m)[0] != before,
                                                    message_id=result.id)
                    cursor.update(page=cursor["page"] + 1, done_buttons=[], advance=None)
                    self.checkpoint()
                for number in numeric_buttons(result):
                    if number in cursor["done_buttons"]:
                        continue
                    if not cursor.get("request"):
                        if len(self.state["tracks"]) >= self.args.limit:
                            await self.drain(all_pending=True)
                            return
                        baseline = await self.latest(self.source)
                        cursor["request"] = {"number": number, "after": baseline}
                        self.checkpoint()
                        # One button at a time; rapid clicks can be dropped by the source bot.
                        await self.call(lambda: result.click(text=number))
                    request = cursor["request"]
                    if request["number"] != number:
                        raise RuntimeError("Qidiruv tartibi o'zgargan; saqlangan cursor'ni tekshiring.")
                    msg = await self.wait_source(request["after"], lambda m: bool(m.audio))
                    await self.forward(msg, artist)
                    cursor["done_buttons"].append(number)
                    cursor["request"] = None
                    self.checkpoint()
                next_button = next((b for row in (result.buttons or []) for b in row
                                    if "➡" in b.text), None)
                if not next_button or cursor["page"] >= self.args.pages_per_artist:
                    break
                cursor["advance"] = result.raw_text
                self.checkpoint()
                await self.call(lambda: next_button.click())
            self.state["completed_artists"].append(artist)
            self.state["cursor"] = None
            self.checkpoint()
        await self.drain(all_pending=True)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--login", action="store_true", help="Only log in locally; do not send messages")
    p.add_argument("--artists", type=Path, default=Path("scripts/import_artists.txt"))
    p.add_argument("--session", default=".cavi-import/account")
    p.add_argument("--state", type=Path, default=Path(".cavi-import/state.json"))
    p.add_argument("--limit", type=int, default=1000, help="Total tracked files, including previous runs")
    p.add_argument("--pages-per-artist", type=int, default=10)
    p.add_argument("--max-pending", type=int, default=10)
    p.add_argument("--delay", type=float, default=5)
    p.add_argument("--source-timeout", type=int, default=180)
    p.add_argument("--target-timeout", type=int, default=3600)
    return p


async def main(args):
    from telethon import TelegramClient
    api_id = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")
    if args.login:
        api_id = api_id or input("Telegram api_id: ").strip()
        api_hash = api_hash or getpass.getpass("Telegram api_hash: ").strip()
    if not api_id or not api_hash:
        raise RuntimeError("TELEGRAM_API_ID va TELEGRAM_API_HASH kerak. Ularni chatga yubormang.")
    if min(args.limit, args.pages_per_artist, args.max_pending, args.source_timeout, args.target_timeout) < 1 or args.delay < 1:
        raise RuntimeError("Sonlar musbat, --delay kamida 1 bo'lishi kerak.")
    session_dir = Path(args.session).parent
    session_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    client = TelegramClient(args.session, int(api_id), api_hash, flood_sleep_threshold=0)
    try:
        await client.connect()
        if args.login:
            await client.start(phone=lambda: input("Telefon: "),
                               code_callback=lambda: getpass.getpass("Telegram kodi: "),
                               password=lambda: getpass.getpass("2FA parol: "))
            print("Kirish saqlandi. Session faylini GitHub'ga yoki chatga yubormang.")
            return
        if not await client.is_user_authorized():
            raise RuntimeError("Avval --login bilan shu kompyuterda kiring.")
        me = await client.get_me()
        if me.bot:
            raise RuntimeError("Bot session emas, Cavi egasining akkaunti kerak.")
        artists = list(dict.fromkeys(x.strip() for x in args.artists.read_text(encoding="utf-8").splitlines()
                                    if x.strip() and not x.lstrip().startswith("#")))
        state = json.loads(args.state.read_text()) if args.state.exists() else {
            "account_id": me.id, "tracks": {}, "completed_artists": [], "cursor": None}
        if state["account_id"] != me.id:
            raise RuntimeError("Holat boshqa akkauntga tegishli.")
        source = await client.get_entity("YuklaydiBot")
        target = await client.get_entity("CaviSpotifybot")
        if not source.bot or not target.bot:
            raise RuntimeError("Manba yoki qabul qiluvchi bot emas.")
        await Importer(client, source, target, args, state).run(artists)
        counts = {}
        for track in state["tracks"].values():
            counts[track["status"]] = counts.get(track["status"], 0) + 1
        print(json.dumps(counts, ensure_ascii=False))
    finally:
        await client.disconnect()


if __name__ == "__main__":
    os.umask(0o077)
    try:
        asyncio.run(main(parser().parse_args()))
    except (RuntimeError, TimeoutError, ValueError) as exc:
        raise SystemExit(str(exc))
    except KeyboardInterrupt:
        print("To'xtatildi. Holat saqlangan; shu buyruq bilan davom eting.")
