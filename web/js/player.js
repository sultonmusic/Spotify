// Player: queue, shuffle/repeat, autoplay radio, lock-screen controls, loudness
// normalisation and Spotify-style play counting (>= 30 s listened).
import { CONFIG } from "./config.js";
import { lib, song as getSong, recordPlay, recordSkip, addListenTime, coverUrl, emit, user } from "./store.js";
import { radio } from "./reco.js";
import { setClosingGuard } from "./tg.js";
import { AudioEngine } from "./engines.js";
import { t } from "./i18n.js";

const STATE_KEY = "ms.player.v1";

export const player = {
  queue: [], // song ids of the current context (shuffled order when shuffle is on)
  order: [], // original context order (to undo shuffle)
  index: -1,
  upNext: [], // "Add to queue" items, played before the rest of the context
  context: { type: "", id: "", title: "" },
  shuffle: false,
  repeat: "off", // off | all | one
  volume: 1,
  current: null,
};

const audioEngine = new AudioEngine((ev) => onEngine(audioEngine, ev));
let engine = audioEngine;

export const currentTime = () => engine.time;
export const duration = () => engine.duration || player.current?.duration || 0;
export const isPlaying = () => !!player.current && !engine.paused;

// ------------------------------------------------------------------ listening session (play counting)
let session = null;
function startSession(s) {
  endSession(false);
  session = { id: s.id, listened: 0, counted: false, last: 0 };
}
function endSession(userSkipped) {
  if (!session) return;
  addListenTime(session.listened);
  if (userSkipped && !session.counted && session.listened < CONFIG.playThreshold) recordSkip(session.id);
  session = null;
}
function trackTime() {
  if (!session || engine.paused) return;
  const now = engine.time;
  const delta = now - session.last;
  if (delta > 0 && delta < 1.6) session.listened += delta;
  session.last = now;
  const threshold = Math.min(CONFIG.playThreshold, (player.current?.duration || engine.duration || 60) * 0.9);
  if (!session.counted && session.listened >= threshold) {
    session.counted = true;
    recordPlay(session.id);
  }
}

// ------------------------------------------------------------------ helpers
const volumeFor = (s) => Math.max(0, Math.min(1, player.volume * Math.pow(10, (s?.gain || 0) / 20))); // gain: dB, <= 0 (-14 LUFS)
let fading = null;
function applyVolume() {
  if (fading) return; // the fade-in ends at the right volume by itself
  engine.setVolume(volumeFor(player.current));
}
/** Soft start after a reload instead of an abrupt jump in. */
function fadeIn(ms = 600) {
  clearInterval(fading);
  const t0 = performance.now();
  engine.setVolume(0);
  fading = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    engine.setVolume(volumeFor(player.current || early?.song) * k * k);
    if (k >= 1) { clearInterval(fading); fading = null; }
  }, 30);
}

function setMediaSession(s) {
  if (!("mediaSession" in navigator) || !s) return;
  const art = coverUrl(s);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: s.title,
    artist: s.artist,
    album: s.album || CONFIG.appName,
    artwork: art ? [{ src: new URL(art, location.href).href, sizes: "600x600", type: "image/jpeg" }] : [],
  });
}

function updatePositionState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = engine.duration;
  if (!isFinite(d) || d <= 0) return;
  try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(engine.time, d), playbackRate: 1 }); } catch { /* ignore */ }
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

let errorStreak = 0;

// ------------------------------------------------------------------ loading
function load(s, { autoplay = true, at = 0 } = {}) {
  player.current = s;
  startSession(s);
  if (at > 0 && session) session.last = at;
  applyVolume();
  engine.load(s, { autoplay, at });
  setMediaSession(s);
  emit("track", s);
  saveState();
}

export function play() {
  if (!player.current) return;
  engine.play();
}
export function pause() { engine.pause(); }
export function toggle() { if (engine.paused) play(); else pause(); }

/** Play a list of songs (ids or objects) starting at `start`. */
export function playList(items, start = 0, context = {}, at = 0) {
  const startId = typeof items[start] === "string" ? items[start] : items[start]?.id;
  const ids = items.map((x) => (typeof x === "string" ? x : x.id)).filter((id) => getSong(id));
  if (!ids.length) return;
  const first = Math.max(0, ids.indexOf(startId));
  player.order = ids.slice();
  player.context = { type: context.type || "list", id: context.id || "", title: context.title || "" };
  if (player.shuffle) {
    player.queue = [ids[first], ...shuffleArray(ids.filter((_, i) => i !== first))];
    player.index = 0;
  } else {
    player.queue = ids;
    player.index = first;
  }
  load(getSong(player.queue[player.index]), { at });
  emit("queue");
}

/** Play one song (optionally from a moment) and continue with a personalised radio of similar songs. */
export function playRadio(s, context, at = 0) {
  const rest = radio(s, 40);
  playList([s, ...rest], 0, context || { type: "radio", id: s.id, title: t("ctx.radioOf", { t: s.title }) }, at);
}

export function playSong(s, list, context) {
  if (player.current?.id === s.id) { toggle(); return; }
  if (list && list.length) playList(list, Math.max(0, list.findIndex((x) => (x.id || x) === s.id)), context);
  else playRadio(s, context);
}

export function next(userAction = true) {
  if (userAction) endSession(true);
  if (player.upNext.length) {
    const id = player.upNext.shift();
    player.queue.splice(player.index + 1, 0, id);
    player.index += 1;
    load(getSong(id));
    emit("queue");
    return;
  }
  if (player.index < player.queue.length - 1) {
    player.index += 1;
    load(getSong(player.queue[player.index]));
  } else if (player.repeat === "all" && player.queue.length) {
    player.index = 0;
    load(getSong(player.queue[0]));
  } else if (player.current) {
    // Autoplay: keep the music going with songs similar to what just played.
    const recent = new Set(player.queue.slice(-25));
    const more = radio(player.current, 25, recent).map((s) => s.id);
    if (!more.length) { pause(); return; }
    player.queue.push(...more);
    player.order.push(...more);
    if (player.context.type !== "radio") player.context = { type: "autoplay", id: "", title: t("ctx.autoplay") };
    player.index += 1;
    load(getSong(player.queue[player.index]));
  }
  emit("queue");
}

export function prev() {
  if (engine.time > 4 || player.index <= 0) {
    seek(0);
    play();
    return;
  }
  endSession(true);
  player.index -= 1;
  load(getSong(player.queue[player.index]));
  emit("queue");
}

export function seek(seconds) {
  if (!isFinite(seconds)) return;
  const d = engine.duration;
  engine.seek(Math.max(0, d ? Math.min(seconds, d) : seconds));
  if (session) session.last = Math.max(0, seconds);
  updatePositionState();
}

export function jumpTo(queueIndex) {
  if (queueIndex < 0 || queueIndex >= player.queue.length) return;
  endSession(true);
  player.index = queueIndex;
  load(getSong(player.queue[queueIndex]));
  emit("queue");
}

export function addToQueue(s) {
  player.upNext.push(s.id);
  if (!player.current) next(false);
  emit("queue");
}

export function playNext(s) {
  player.upNext.unshift(s.id);
  if (!player.current) next(false);
  emit("queue");
}

export function removeUpNext(i) {
  player.upNext.splice(i, 1);
  emit("queue");
}

export function setShuffle(on) {
  player.shuffle = on;
  if (!player.queue.length) { emit("modes"); return; }
  const cur = player.queue[player.index];
  if (on) {
    const rest = player.queue.slice(player.index + 1);
    player.queue = [...player.queue.slice(0, player.index + 1), ...shuffleArray(rest)];
  } else {
    player.queue = player.order.slice();
    player.index = Math.max(0, player.queue.indexOf(cur));
  }
  saveState();
  emit("modes");
  emit("queue");
}

export function cycleRepeat() {
  player.repeat = player.repeat === "off" ? "all" : player.repeat === "all" ? "one" : "off";
  saveState();
  emit("modes");
}

export function setVolume(v) {
  player.volume = Math.max(0, Math.min(1, v));
  applyVolume();
  saveState();
}

export function upcoming(limit = 50) {
  return {
    upNext: player.upNext.map(getSong).filter(Boolean),
    rest: player.queue.slice(player.index + 1, player.index + 1 + limit).map(getSong).filter(Boolean),
  };
}

// ------------------------------------------------------------------ persistence
let saveTimer = null;
/** Just enough of the song to start it again before the library has loaded (see earlyResume). */
const songSnap = (s) => (s ? { id: s.id, src: s.src, duration: s.duration, gain: s.gain, title: s.title, artist: s.artist,
  album: s.album, cover: s.cover, coverV: s.coverV } : null);
function saveStateNow() {
  clearTimeout(saveTimer);
  try {
    const from = Math.max(0, player.index - 50);
    localStorage.setItem(STATE_KEY, JSON.stringify({
      queue: player.queue.slice(from, player.index + 200),
      index: player.index - from,
      order: player.order.slice(0, 400),
      upNext: player.upNext,
      context: player.context,
      shuffle: player.shuffle,
      repeat: player.repeat,
      volume: player.volume,
      time: engine.time || 0,
      playing: isPlaying(), // after a reload the music continues from the same moment
      song: songSnap(player.current),
      savedAt: Date.now(),
    }));
  } catch { /* ignore */ }
}
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, 400);
}

function readState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || "null"); } catch { return null; }
}
const RESUME_WINDOW = 30 * 60_000;

/**
 * A page reload stops the sound. To keep the gap as short as possible the song starts again right away,
 * before songs.json has even loaded, at the moment it would have reached (the reload time is added back).
 */
let early = null;
(function earlyResume() {
  const st = readState();
  const snap = st?.song;
  if (!st?.playing || !snap?.src || Date.now() - (st.savedAt || 0) > RESUME_WINDOW) return;
  const away = (Date.now() - st.savedAt) / 1000;
  const at = Math.max(0, Math.min((st.time || 0) + (away < 12 ? away : 0), (snap.duration || 1e9) - 1));
  player.volume = typeof st.volume === "number" ? st.volume : 1;
  early = { id: snap.id, song: snap };
  setMediaSession(snap);
  audioEngine.load(snap, { autoplay: true, at });
  fadeIn();
})();

/** Asks for one tap when the browser didn't allow sound to start by itself after the reload. */
function resumeOnFirstTap() {
  setTimeout(() => {
    if (isPlaying()) return;
    const go = () => { if (!isPlaying()) { fadeIn(); play(); } off(); };
    const off = () => ["pointerdown", "keydown", "touchend"].forEach((ev) => document.removeEventListener(ev, go, true));
    ["pointerdown", "keydown", "touchend"].forEach((ev) => document.addEventListener(ev, go, { capture: true, once: true }));
  }, 700);
}

export function restore() {
  const st = readState();
  const started = early;
  early = null;
  if (!st) { if (started) audioEngine.stop(); return; }
  player.shuffle = !!st.shuffle;
  player.repeat = st.repeat || "off";
  player.volume = typeof st.volume === "number" ? st.volume : 1;
  player.queue = (st.queue || []).filter((id) => getSong(id));
  player.order = (st.order || []).filter((id) => getSong(id));
  player.upNext = (st.upNext || []).filter((id) => getSong(id));
  player.context = st.context || player.context;
  player.index = Math.max(0, Math.min(st.index || 0, player.queue.length - 1));
  const s = getSong(player.queue[player.index]);
  if (!s) { if (started) audioEngine.stop(); emit("modes"); emit("queue"); return; }
  if (started && started.id === s.id) {
    // Already playing since the page opened: just attach it to the library's song.
    player.current = s;
    startSession(s);
    if (session) session.last = engine.time;
    applyVolume();
    setMediaSession(s);
    emit("track", s);
    emit("state", { playing: isPlaying() });
    if (!isPlaying()) resumeOnFirstTap();
  } else {
    if (started) audioEngine.stop();
    // Continue exactly where it was; keep playing if it was playing (within the last 30 minutes).
    const resume = !!st.playing && Date.now() - (st.savedAt || 0) < RESUME_WINDOW;
    load(s, { autoplay: false, at: Math.max(0, st.time || 0) });
    if (resume) {
      fadeIn();
      engine.play();
      resumeOnFirstTap();
    }
  }
  emit("modes");
  emit("queue");
}

// ------------------------------------------------------------------ engine events
function onEngine(src, ev) {
  if (src !== engine) return; // a stopped engine may still report
  if (!player.current) return; // the early resume before the library loaded: restore() takes over
  switch (ev) {
    case "time":
      trackTime();
      emit("time", { t: engine.time, d: duration() });
      break;
    case "seeked":
      if (session) session.last = engine.time;
      updatePositionState();
      break;
    case "play":
      if (session) session.last = engine.time;
      errorStreak = 0;
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
      setClosingGuard(true);
      emit("state", { playing: true });
      break;
    case "pause":
      trackTime();
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
      setClosingGuard(false);
      saveState();
      emit("state", { playing: false });
      break;
    case "waiting":
      emit("state", { playing: true, buffering: true });
      break;
    case "playing":
      emit("state", { playing: true, buffering: false });
      break;
    case "meta":
      updatePositionState();
      emit("time", { t: engine.time, d: duration() });
      break;
    case "ended":
      trackTime();
      if (player.repeat === "one") {
        endSession(false);
        startSession(player.current);
        seek(0);
        play();
        return;
      }
      endSession(false);
      next(false);
      break;
    case "error":
      errorStreak += 1;
      emit("error", { song: player.current });
      if (errorStreak < 3) setTimeout(() => next(false), 1200);
      break;
    default:
  }
}

setInterval(() => { if (isPlaying()) saveStateNow(); }, 3000);
window.addEventListener("pagehide", () => { trackTime(); saveStateNow(); endSession(false); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveStateNow(); });

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported */ } };
  set("play", play);
  set("pause", pause);
  set("previoustrack", prev);
  set("nexttrack", () => next(true));
  set("seekto", (d) => seek(d.seekTime));
  set("seekbackward", (d) => seek(engine.time - (d.seekOffset || 10)));
  set("seekforward", (d) => seek(engine.time + (d.seekOffset || 10)));
}

// Keep ids valid when the library reloads (a song may have been deleted).
export function pruneMissing() {
  const ok = (id) => lib.byId.has(id);
  player.upNext = player.upNext.filter(ok);
  player.order = player.order.filter(ok);
  const cur = player.queue[player.index];
  player.queue = player.queue.filter(ok);
  player.index = Math.max(0, player.queue.indexOf(cur));
  emit("queue");
}

export const listenedSeconds = () => user.listen + (session?.listened || 0);
