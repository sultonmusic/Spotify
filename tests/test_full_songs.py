"""Tests for the official full-song workflow (bot/youtube.py, bot/acquire.py, Station.publish_full_song).

Network services (YouTube Data API, YouTube media, Jamendo, Shazam, catalogs, Telegram) are replaced by
fakes; ffmpeg/ffprobe, the MP3 conversion, validation and the real catalog code (library/songs.json,
library/audio/) run for real in a temporary copy of the library.

Run: python -m unittest discover -s tests -v
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bot import acquire, config, lookup, youtube  # noqa: E402
from bot.youtube import Video  # noqa: E402

CC_CHANNEL = "UC" + "a" * 22
OWN_CHANNEL = "UC" + "b" * 22


def tone(path: Path, seconds: float, freq: int = 440) -> Path:
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}",
                    "-ac", "2", "-c:a", "aac", "-b:a", "128k", str(path)], check=True)
    return path


def video(**kw) -> Video:
    base = dict(id="vid00000001", title="Adele - Hello (Official Music Video)", channel_id="UCx" + "0" * 21,
                channel="Adele", duration=295, license="youtube", licensed_content=True)
    base.update(kw)
    return Video(**base)


class RankingTests(unittest.TestCase):
    def rank(self, v: Video, duration: float = 295) -> Video:
        return youtube.score_video(v, "Hello", "Adele", duration)

    def test_official_music_video_from_artist_channel(self):
        v = self.rank(video())
        self.assertTrue(v.official)
        self.assertEqual(v.kind, "official-video")

    def test_topic_channel_is_official_audio(self):
        v = self.rank(video(title="Hello", channel="Adele - Topic", duration=296))
        self.assertTrue(v.official)
        self.assertEqual(v.kind, "topic")

    def test_vevo_channel(self):
        self.assertTrue(self.rank(video(channel="AdeleVEVO")).official)

    def test_official_word_on_random_channel_is_not_official(self):
        v = self.rank(video(channel="Best Music 2024", licensed_content=False))
        self.assertFalse(v.official)

    def test_variants_rejected(self):
        for title in ("Adele - Hello (Cover by Someone)", "Adele - Hello (Remix)", "Hello - Adele (Nightcore)",
                      "Adele - Hello (sped up)", "Adele - Hello slowed + reverb", "Adele - Hello (Karaoke)",
                      "Adele - Hello (Live at the BBC)"):
            with self.subTest(title=title):
                v = self.rank(video(title=title))
                self.assertFalse(v.official, title)
                self.assertLess(v.score, self.rank(video()).score)

    def test_fan_lyric_video_rejected(self):
        v = self.rank(video(title="Adele - Hello (Lyrics)", channel="LyricsWorld", licensed_content=False))
        self.assertFalse(v.official)

    def test_wrong_duration_penalised(self):
        good, bad = self.rank(video()), self.rank(video(duration=600))
        self.assertLess(bad.score, good.score)

    def test_asked_for_remix_is_not_punished(self):
        v = youtube.score_video(video(title="Adele - Hello (Remix)"), "Hello (Remix)", "Adele", 0)
        self.assertTrue(v.official)

    def test_priority_music_video_first_unless_it_has_an_intro(self):
        mv = self.rank(video(id="mv", duration=296))
        audio = self.rank(video(id="au", title="Adele - Hello (Official Audio)", duration=295))
        topic = self.rank(video(id="tp", title="Hello", channel="Adele - Topic", duration=295))
        self.assertEqual(youtube.best_official([topic, audio, mv], 295).id, "mv")
        mv_intro = self.rank(video(id="mv2", duration=360))
        self.assertEqual(youtube.best_official([topic, audio, mv_intro], 295).id, "au")

    def test_duration_parser(self):
        self.assertEqual(youtube.parse_duration("PT4M55S"), 295)
        self.assertEqual(youtube.parse_duration("PT1H2M3S"), 3723)
        self.assertEqual(youtube.parse_duration("bad"), 0)


class SearchTests(unittest.TestCase):
    """youtube.search() against recorded-shape API responses."""

    def fake_get(self, url, params=None, timeout=None):
        resp = mock.Mock(status_code=200)
        if url.endswith("/search"):
            resp.json.return_value = {"items": [{"id": {"videoId": i}} for i in ("a1", "b2", "c3")]}
        else:
            def item(i, title, channel, dur, lic="youtube", claimed=True):
                return {"id": i, "snippet": {"title": title, "channelTitle": channel, "channelId": "UC" + i * 11,
                                             "description": "", "thumbnails": {}},
                        "contentDetails": {"duration": dur, "licensedContent": claimed},
                        "status": {"license": lic, "privacyStatus": "public", "embeddable": True}}
            resp.json.return_value = {"items": [
                item("a1", "Adele - Hello (Nightcore)", "nc fan", "PT3M50S", claimed=False),
                item("b2", "Adele - Hello (Official Music Video)", "Adele", "PT6M7S"),
                item("c3", "Hello", "Adele - Topic", "PT4M56S"),
            ]}
        return resp

    def test_search_ranks_and_reads_licence(self):
        with mock.patch.object(config, "YOUTUBE_API_KEY", "test-key"), \
                mock.patch.object(youtube._session, "get", side_effect=self.fake_get):
            videos = youtube.search("Hello", "Adele", 295)
        self.assertEqual({v.id for v in videos if v.official}, {"b2", "c3"})
        self.assertFalse(next(v for v in videos if v.id == "a1").official)
        best = youtube.best_official(videos, 295)
        self.assertEqual(best.id, "c3")  # the music video has a 70 s intro -> the Topic audio wins

    def test_api_error_never_leaks_key(self):
        resp = mock.Mock(status_code=403)
        resp.json.return_value = {"error": {"errors": [{"reason": "quotaExceeded"}]}}
        with mock.patch.object(config, "YOUTUBE_API_KEY", "SECRET-KEY"), \
                mock.patch.object(youtube._session, "get", return_value=resp):
            with self.assertRaises(youtube.YouTubeError) as ctx:
                youtube.search("Hello", "Adele")
        self.assertNotIn("SECRET-KEY", str(ctx.exception))
        self.assertIn("quotaExceeded", str(ctx.exception))


class PermissionTests(unittest.TestCase):
    def test_standard_licence_denied(self):
        self.assertFalse(acquire.youtube_permission(video())[0])

    def test_creative_commons_allowed_by_default_and_switchable(self):
        cc = video(license="creativeCommon")
        with mock.patch.object(config, "YT_ALLOW_CREATIVE_COMMONS", True):
            self.assertTrue(acquire.youtube_permission(cc)[0])
        with mock.patch.object(config, "YT_ALLOW_CREATIVE_COMMONS", False):
            self.assertFalse(acquire.youtube_permission(cc)[0])

    def test_owner_authorised_channel(self):
        v = video(channel_id=OWN_CHANNEL)
        with mock.patch.object(config, "YT_AUTHORIZED_CHANNELS", f"{OWN_CHANNEL}, junk"):
            self.assertTrue(acquire.youtube_permission(v)[0])
            self.assertEqual(acquire.authorized_channels(), {OWN_CHANNEL})


class AudioTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_full_song_converts_to_valid_mp3(self):
        src = tone(self.tmp / "song.m4a", 125)
        mp3 = acquire.to_mp3(src, self.tmp / "out.mp3", {"title": "Hello", "artist": "Adele"})
        info = acquire.validate(mp3, 125)
        self.assertEqual(info.codec, "mp3")
        self.assertAlmostEqual(info.duration, 125, delta=1)
        self.assertEqual(info.tags.get("title"), "Hello")

    def test_preview_rejected(self):
        with self.assertRaisesRegex(acquire.AcquireError, "preview"):
            acquire.validate(tone(self.tmp / "p.m4a", 30), 0)

    def test_incomplete_rejected(self):
        with self.assertRaisesRegex(acquire.AcquireError, "to'liq emas"):
            acquire.validate(tone(self.tmp / "half.m4a", 100), 240)

    def test_corrupted_rejected(self):
        good = tone(self.tmp / "g.m4a", 120)
        data = bytearray(good.read_bytes())
        for i in range(len(data) // 3, len(data) // 3 + 40000):
            data[i] = 0xFF
        bad = self.tmp / "bad.m4a"
        bad.write_bytes(bytes(data))
        with self.assertRaises(acquire.AcquireError):
            acquire.validate(bad, 120)


def fake_ydl(duration: float, license_text: str, channel_id: str):
    """Stand-in for yt_dlp.YoutubeDL: writes a real audio file where yt-dlp would."""
    class FakeYDL:
        def __init__(self, options):
            self.out = Path(options["outtmpl"].replace("%(ext)s", "m4a"))
            assert options["allow_unplayable_formats"] is False and options["cookiefile"] is None

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, url, download=True):
            tone(self.out, duration)
            return {"channel_id": channel_id, "license": license_text}
    return FakeYDL


class StationTests(unittest.TestCase):
    """The whole pipeline through the real Station/Library code, in a temporary repository root."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "library").mkdir()
        (self.root / "bot").mkdir()
        (self.root / "web").symlink_to(ROOT / "web")
        lib = self.root / "library"
        self.patches = [mock.patch.object(config, k, v) for k, v in {
            "ROOT": self.root, "LIBRARY_DIR": lib, "AUDIO_DIR": lib / "audio", "COVERS_DIR": lib / "covers",
            "LYRICS_DIR": lib / "lyrics", "ARTISTS_DIR": lib / "artists", "SONGS_FILE": lib / "songs.json",
            "STATE_FILE": self.root / "bot" / "state.json", "AUDIO_STORAGE": "pages", "ANTHROPIC_API_KEY": "",
            "YOUTUBE_API_KEY": "test-key", "JAMENDO_CLIENT_ID": "", "YT_AUTHORIZED_CHANNELS": "",
            "YT_ALLOW_CREATIVE_COMMONS": True, "TOKEN": "123:test", "SITE_URL": "https://example.github.io/Spotify/",
        }.items()]
        self.patches.append(mock.patch.object(lookup, "_get", return_value=None))  # no catalog network
        for p in self.patches:
            p.start()
        from bot import main
        self.main = main
        self.station = main.Station()
        self.messages: list[str] = []
        self.station.bot = mock.Mock()
        self.station.bot.safe.side_effect = self.record
        self.candidate = {"title": "Hello", "artist": "Adele", "duration": 125, "album": "25", "year": 2015}

    def record(self, method, **params):
        if method in ("sendMessage", "editMessageText"):
            self.messages.append(params.get("text", ""))
            self.last_markup = params.get("reply_markup")
        return {"message_id": 77}

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.root, ignore_errors=True)

    def songs(self) -> list[dict]:
        f = self.root / "library" / "songs.json"
        return json.loads(f.read_text())["songs"] if f.exists() else []

    def run_publish(self, vids, ydl=None, shazam=None):
        with mock.patch.object(youtube, "search", return_value=vids), \
                mock.patch.object(lookup, "shazam", return_value=shazam), \
                mock.patch.dict(sys.modules, {"yt_dlp": mock.Mock(YoutubeDL=ydl)} if ydl else {}):
            return self.station.publish_full_song(1, 77, dict(self.candidate))

    def cc_video(self, **kw):
        return youtube.score_video(video(title="Adele - Hello (Official Audio)", channel_id=CC_CHANNEL,
                                         license="creativeCommon", duration=125, **kw), "Hello", "Adele", 125)

    def test_cc_official_song_is_published_and_playable(self):
        ydl = fake_ydl(125, "Creative Commons Attribution license (reuse allowed)", CC_CHANNEL)
        song = self.run_publish([self.cc_video()], ydl, shazam={"title": "Hello", "artist": "Adele"})
        self.assertIsNotNone(song)
        self.assertIn("Muvaffaqiyatli joylandi", self.messages[-1])
        stored = self.songs()
        self.assertEqual(len(stored), 1)
        entry = stored[0]
        audio_file = self.root / entry["src"]
        self.assertTrue(audio_file.is_file())
        self.assertEqual(entry["mime"], "audio/mpeg")
        self.assertEqual(entry["origin"]["provider"], "youtube")
        self.assertIn("Creative Commons", entry["origin"]["license"])
        self.assertAlmostEqual(entry["duration"], 125, delta=1)
        # what the website's <audio> gets: a decodable mp3
        acquire.validate(audio_file, 125)
        # the progress messages the owner sees
        joined = "\n".join(self.messages)
        for step in ("Rasmiy qo'shiq qidirilmoqda", "Ijrochi va kanal", "Yuklab olish ruxsati",
                     "MP3 tayyorlanmoqda", "Cavi Music'ga yuklanmoqda"):
            self.assertIn(step, joined)

        # Same request again -> duplicate, nothing new stored
        self.messages.clear()
        again = self.run_publish([self.cc_video()], ydl, shazam={"title": "Hello", "artist": "Adele"})
        self.assertEqual(again["id"], song["id"])
        self.assertIn("allaqachon bor", self.messages[-1])
        self.assertEqual(len(self.songs()), 1)

    def test_full_song_replaces_catalog_preview(self):
        self.station.lib.add({"id": "prev1", "title": "Hello", "artist": "Adele", "artists": ["Adele"],
                              "duration": 30, "src": "library/audio/prev1.m4a", "previewOnly": True})
        self.station.save()
        ydl = fake_ydl(125, "Creative Commons Attribution license (reuse allowed)", CC_CHANNEL)
        song = self.run_publish([self.cc_video()], ydl, shazam={"title": "Hello", "artist": "Adele"})
        ids = [s["id"] for s in self.songs()]
        self.assertEqual(ids, [song["id"]])

    def test_standard_licence_is_never_downloaded(self):
        official = youtube.score_video(video(duration=126), "Hello", "Adele", 125)
        ydl = mock.Mock(side_effect=AssertionError("must not download"))
        result = self.run_publish([official], ydl)
        self.assertIsNone(result)
        self.assertEqual(self.songs(), [])
        self.assertNotIn("Muvaffaqiyatli", self.messages[-1])
        self.assertIn("standart YouTube litsenziyasi", self.messages[-1])
        button = self.last_markup["inline_keyboard"][0][0]
        self.assertEqual(button["url"], official.url)  # the exact official video, not a search page

    def test_wrong_song_detected_by_fingerprint(self):
        ydl = fake_ydl(125, "Creative Commons Attribution license (reuse allowed)", CC_CHANNEL)
        result = self.run_publish([self.cc_video()], ydl, shazam={"title": "Rolling in the Deep", "artist": "Adele"})
        self.assertIsNone(result)
        self.assertEqual(self.songs(), [])
        self.assertIn("boshqa qo'shiq", self.messages[-1])

    def test_licence_changed_after_search_is_rejected(self):
        ydl = fake_ydl(125, "Standard YouTube License", CC_CHANNEL)
        self.assertIsNone(self.run_publish([self.cc_video()], ydl))
        self.assertEqual(self.songs(), [])

    def test_youtube_blocking_is_reported_not_bypassed(self):
        class Blocked:
            def __init__(self, options):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def extract_info(self, *a, **k):
                raise RuntimeError("Sign in to confirm you're not a bot")
        self.assertIsNone(self.run_publish([self.cc_video()], Blocked))
        self.assertIn("chetlab o'tilmaydi", self.messages[-1])
        self.assertEqual(self.songs(), [])

    def test_preview_length_download_rejected(self):
        ydl = fake_ydl(30, "Creative Commons Attribution license (reuse allowed)", CC_CHANNEL)
        self.assertIsNone(self.run_publish([self.cc_video()], ydl))
        self.assertEqual(self.songs(), [])

    def test_jamendo_alternative(self):
        src = tone(self.root / "jam.m4a", 125)
        rows = {"headers": {"status": "success"}, "results": [{
            "id": 42, "name": "Hello", "artist_name": "Adele", "duration": 125, "audiodownload_allowed": True,
            "audiodownload": "https://prod-1.storage.jamendo.com/download/track/42/mp32/",
            "shareurl": "https://www.jamendo.com/track/42", "license_ccurl": "http://creativecommons.org/licenses/by-sa/3.0/"}]}

        def fake_get(url, params=None, stream=False, timeout=None):
            resp = mock.MagicMock(status_code=200, url=url)
            resp.json.return_value = rows
            resp.__enter__.return_value = resp
            resp.iter_content.return_value = [src.read_bytes()]
            return resp
        with mock.patch.object(config, "JAMENDO_CLIENT_ID", "jam"), \
                mock.patch.object(acquire.requests, "get", side_effect=fake_get):
            song = self.run_publish([youtube.score_video(video(), "Hello", "Adele", 125)], None,
                                    shazam=None)
        self.assertIsNotNone(song)
        entry = self.songs()[0]
        self.assertEqual(entry["origin"]["provider"], "jamendo")
        self.assertEqual(entry["origin"]["license"], "CC BY-SA")

    def test_instagram_flow_still_works_and_offers_full_version(self):
        reel = "https://www.instagram.com/reel/ABCdef123/"
        clip = tone(self.root / "reel.m4a", 20)
        cands = [{"title": "Hello", "artist": "Adele", "duration": 295, "score": 0.95}]
        with mock.patch.object(self.main, "download_instagram", return_value=clip), \
                mock.patch.object(lookup, "shazam", return_value={"title": "Hello", "artist": "Adele"}), \
                mock.patch.object(lookup, "search_candidates", return_value=cands):
            self.station.handle_instagram({"chat": {"id": 1}, "message_id": 5}, reel)
        self.assertIn("Rolikdan topilgan", self.messages[-1])
        token = next(iter(self.station.state["instagram_jobs"]))
        markup = self.station.instagram_selection_markup(token, 0, cands[0], owner=True)
        datas = [b.get("callback_data") for row in markup["inline_keyboard"] for b in row]
        self.assertIn(f"igfull:{token}:0", datas)
        self.assertIn(f"igadd:{token}:0", datas)  # the existing "add the Reel clip" option is kept
        guest = self.station.instagram_selection_markup(token, 0, cands[0], owner=False)
        self.assertNotIn(f"igfull:{token}:0",
                         [b.get("callback_data") for row in guest["inline_keyboard"] for b in row])

    def test_full_callback_requires_owner(self):
        self.station.state["owner"] = "someone-else"
        self.station.state["instagram_jobs"] = {"tok": {"t": 9e12, "chat": 1, "candidates": [self.candidate]}}
        with mock.patch.object(self.station, "publish_full_song") as publish:
            self.station.handle_callback({"id": "q", "data": "igfull:tok:0", "from": {"id": 999},
                                          "message": {"chat": {"id": 1}, "message_id": 77}})
        publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
