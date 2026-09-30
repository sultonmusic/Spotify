"""Offline checks for queue limits, acknowledgment and crash recovery."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace as NS
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bulk", Path(__file__).with_name("bulk_import.py"))
bulk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bulk)


async def no_sleep(_):
    pass


class FakeMessage:
    def __init__(self, client, mid, text="", audio=False, out=False, reply=None):
        self.client, self.id, self.raw_text, self.out = client, mid, text, out
        self.audio = audio
        self.document = NS(id=10000 + mid) if audio else None
        self.reply_to_msg_id = reply
        self.buttons = []

    async def click(self, text):
        mid = max(m.id for m in self.client.source) + 1
        self.client.source.append(FakeMessage(self.client, mid, audio=True))


class FakeClient:
    def __init__(self):
        self.source, self.target, self.forwards = [], [], 0

    async def get_messages(self, peer, limit=1, min_id=0, ids=None):
        items = self.source if peer == "source" else self.target
        if ids is not None:
            return next((m for m in items if m.id == ids), None)
        return list(reversed([m for m in items if m.id > min_id]))[:limit]

    async def send_message(self, peer, artist):
        mid = max((m.id for m in self.source), default=0) + 1
        msg = FakeMessage(self, mid, artist)
        msg.buttons = [[NS(text="1"), NS(text="2")]]
        self.source.append(msg)

    async def forward_messages(self, target, msg):
        self.forwards += 1
        mid = max((m.id for m in self.target), default=0) + 1
        sent = FakeMessage(self, mid, audio=True, out=True)
        sent.document = msg.document
        self.target.extend([sent, FakeMessage(self, mid + 1,
                           "✅ Stansiyaga qo'shildi!", reply=mid)])
        return sent

    async def iter_messages(self, peer, min_id=0, limit=None):
        items = self.target if peer == "target" else self.source
        items = list(reversed([m for m in items if m.id > min_id]))
        for msg in items[:limit] if limit else items:
            yield msg


class ImportTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.args = bulk.parser().parse_args([])
        self.args.state = Path(self.tmp.name) / "state.json"
        self.args.limit = 1
        self.args.max_pending = 1
        self.state = {"tracks": {}, "completed_artists": [], "cursor": None}
        self.client = FakeClient()
        self.importer = bulk.Importer(self.client, "source", "target", self.args, self.state)

    def tearDown(self):
        self.tmp.cleanup()

    async def test_resume_total_limit_and_ack(self):
        with patch.object(bulk.asyncio, "sleep", no_sleep):
            await self.importer.run(["Artist"])
            self.assertEqual(self.client.forwards, 1)
            self.assertEqual(self.state["cursor"]["done_buttons"], ["1"])
            self.assertEqual(next(iter(self.state["tracks"].values()))["status"], "added")
            self.args.limit = 2
            await self.importer.run(["Artist"])
            self.assertEqual(self.client.forwards, 2)
            self.assertEqual(self.state["completed_artists"], ["Artist"])
            await self.importer.run(["Artist"])
            self.assertEqual(self.client.forwards, 2)

    async def test_crash_reconciles_without_resending(self):
        msg = FakeMessage(self.client, 5, audio=True)
        sent = await self.client.forward_messages("target", msg)
        self.state["tracks"][str(msg.document.id)] = {"status": "sending", "source_id": msg.id}
        await self.importer.recover()
        item = self.state["tracks"][str(msg.document.id)]
        self.assertEqual(item["target_id"], sent.id)
        self.assertEqual(item["status"], "added")
        self.assertEqual(self.client.forwards, 1)

    async def test_unknown_delivery_stops(self):
        self.state["tracks"]["unknown"] = {"status": "sending"}
        with self.assertRaises(RuntimeError):
            await self.importer.recover()
        self.assertEqual(self.client.forwards, 0)

    async def test_changed_artist_plan_stops(self):
        self.state["cursor"] = {"artist": "Previous"}
        with self.assertRaises(RuntimeError):
            await self.importer.run(["Different"])

    def test_progress_is_not_success(self):
        self.assertIsNone(bulk.outcome("⏳ Qabul qilindi. Yuklab olinmoqda…"))
        self.assertEqual(bulk.outcome("♻️ Takroriy: allaqachon bor"), "duplicate")
        self.assertEqual(bulk.outcome("Buni ham stansiyaga qo'shaymi?"), "review")
        self.assertEqual(bulk.outcome("❌ Qo'shiqni qo'shib bo'lmadi"), "failed")


if __name__ == "__main__":
    unittest.main()
