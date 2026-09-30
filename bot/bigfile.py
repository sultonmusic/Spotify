"""Files over 20 MB: the Bot API can't hand them to bots, but Telegram's own MTProto API can (up to 2 GB).

The bot logs in with its token through Telethon for the one download (needs TELEGRAM_API_ID and
TELEGRAM_API_HASH from https://my.telegram.org). Messages keep arriving through the Bot API as usual.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from . import config

MAX_BYTES = 100 * 1024 * 1024  # what the station accepts through this route


def available() -> bool:
    return bool(config.API_ID and config.API_HASH and config.TOKEN)


async def _download(message_id: int, dest: Path) -> Path:
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    client = TelegramClient(StringSession(), int(config.API_ID), config.API_HASH, connection_retries=3)
    await client.start(bot_token=config.TOKEN)
    try:
        # A bot's private-chat message ids are global to the bot, so no chat is needed to find it.
        msg = await client.get_messages(None, ids=message_id)
        if not msg or not msg.media:
            raise RuntimeError("katta faylli xabar topilmadi")
        path = await client.download_media(msg, file=str(dest))
        if not path:
            raise RuntimeError("faylni yuklab bo'lmadi")
        return Path(path)
    finally:
        await client.disconnect()


def download(message_id: int, dest: Path) -> Path:
    return asyncio.run(_download(message_id, dest))
