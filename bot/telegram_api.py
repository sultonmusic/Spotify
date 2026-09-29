"""Minimal Telegram Bot API client (only what the station needs)."""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import requests


class TelegramError(Exception):
    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code


class Bot:
    def __init__(self, token: str):
        self._token = token
        self._base = f"https://api.telegram.org/bot{token}/"
        self._file_base = f"https://api.telegram.org/file/bot{token}/"
        self._session = requests.Session()

    def _clean(self, text: str) -> str:
        # Never let the token leak into logs or exception messages.
        return text.replace(self._token, "***")

    def call(self, method: str, timeout: int = 0, **params: Any) -> Any:
        payload = {k: v for k, v in params.items() if v is not None}
        for attempt in range(4):
            try:
                resp = self._session.post(self._base + method, json=payload, timeout=timeout + 30)
                data = resp.json()
            except (requests.RequestException, ValueError) as exc:
                if attempt == 3:
                    raise TelegramError(self._clean(f"{method}: {exc}")) from None
                time.sleep(2 ** attempt)
                continue
            if data.get("ok"):
                return data["result"]
            code = data.get("error_code")
            retry_after = (data.get("parameters") or {}).get("retry_after")
            if code == 429 and retry_after and attempt < 3:
                time.sleep(min(int(retry_after), 30))
                continue
            if code and code >= 500 and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            raise TelegramError(f"{method}: {data.get('description')}", code)
        raise TelegramError(f"{method}: failed")

    def safe(self, method: str, **params: Any) -> Any:
        """Call that never raises (for cosmetic calls like chat actions)."""
        try:
            return self.call(method, **params)
        except TelegramError as exc:
            print(f"[telegram] {exc}")
            return None

    def download(self, file_id: str, dest: Path) -> Path:
        info = self.call("getFile", file_id=file_id)
        file_path = info.get("file_path")
        if not file_path:
            raise TelegramError("getFile: no file_path (file too big?)")
        try:
            with self._session.get(self._file_base + file_path, stream=True, timeout=180) as resp:
                resp.raise_for_status()
                with open(dest, "wb") as fh:
                    for chunk in resp.iter_content(chunk_size=1 << 16):
                        fh.write(chunk)
        except requests.RequestException as exc:
            raise TelegramError(self._clean(f"download: {exc}")) from None
        return dest
