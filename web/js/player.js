// Audio engine: queue, shuffle/repeat, autoplay radio, lock-screen controls,
// loudness normalisation and Spotify-style play counting (>= 30 s listened).
import { CONFIG } from "./config.js";
import { lib, song as getSong, recordPlay, recordSkip, addListenTime, coverUrl, emit, user } from "./store.js";
import { radio } from "./reco.js";
import { setClosingGuard } from "./tg.js";

const STATE_KEY = "ms.player.v1";
const audio = new Audio();
audio.preload = "auto";
audio.setAttribute("playsinline", "");

export const player = {
  audio,
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
  if (!session || audio.paused) return;
  const t = audio.currentTime;
  const delta = t - session.last;
  if (delta > 0 && delta < 1.6) session.listened += delta;
  session.last = t;
  const s = player.current;
  const threshold = Math.min(CONFIG.playThreshold, (s?.duration || audio.duration || 60) * 0.9);
  if (!session.counted && session.listened >= threshold) {
    session.counted = true;
    recordPlay(session.id);
  }
}

// ------------------------------------------------------------------ helpers
function applyVolume() {
  const gain = player.current?.gain || 0; // dB, <= 0 (loud songs are turned down to -14 LUFS)
  audio.volume = Math.max(0, Math.min(1, player.volume * Math.pow(10, gain / 20)));
}

function absolute(url) {
  return new URL(url, location.href).href;
}

function setMediaSession(s) {
  if (!("mediaSession" in navigator) || !s) return;
  const art = coverUrl(s);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: s.title,
    artist: s.artist,
    album: s.album || CONFIG.appName,
    artwork: art ? [{ src: absolute(art), sizes: "600x600", type: "image/jpeg" }] : [],
  });
}

function updatePositionState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = audio.duration;
  if (!isFinite(d) || d <= 0) return;
  try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: 1 }); } catch { /* ignore */ }
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

let errorStreak = 0;
let reloadTried = false;

// ------------------------------------------------------------------ loading
function load(s, { autoplay = true, at = 0 } = {}) {
  player.current = s;
  startSession(s);
  reloadTried = false;
  audio.src = s.src;
  applyVolume();
  if (at > 0) {
    const seek = () => { audio.currentTime = at; session && (session.last = at); };
    audio.addEventListener("loadedmetadata", seek, { once: true });
  }
  setMediaSession(s);
  emit("track", s);
  if (autoplay) play();
  saveState();
}

export function play() {
  if (!player.current) return;
  const p = audio.play();
  if (p && p.catch) p.catch((e) => { if (e.name !== "AbortError") emit("state", { playing: false, error: e }); });
}
export function pause() { audio.pause(); }
export function toggle() { if (audio.paused) play(); else pause(); }
export const isPlaying = () => !audio.paused && !audio.ended;

/** Play a list of songs (ids or objects) starting at `start`. */
export function playList(items, start = 0, context = {}) {
  const ids = items.map((x) => (typeof x === "string" ? x : x.id)).filter((id) => getSong(id));
  if (!ids.length) return;
  player.order = ids.slice();
  player.context = { type: context.type || "list", id: context.id || "", title: context.title || "" };
  if (player.shuffle) {
    const first = ids[start] ?? ids[0];
    player.queue = [first, ...shuffleArray(ids.filter((id) => id !== first))];
    player.index = 0;
  } else {
    player.queue = ids;
    player.index = Math.max(0, Math.min(start, ids.length - 1));
  }
  load(getSong(player.queue[player.index]));
  emit("queue");
}

/** Play one song and continue with a personalised radio of similar songs. */
export function playRadio(s, context) {
  const rest = radio(s, 40);
  playList([s, ...rest], 0, context || { type: "radio", id: s.id, title: `${s.title} radiosi` });
}

export function playSong(s, list, context) {
  if (player.current?.id === s.id) { toggle(); return; }
  if (list && list.length) {
    const idx = list.findIndex((x) => (x.id || x) === s.id);
    playList(list, Math.max(0, idx), context);
  } else playRadio(s, context);
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
    if (player.context.type !== "radio") player.context = { type: "autoplay", id: "", title: "Avtomatik davom" };
    player.index += 1;
    load(getSong(player.queue[player.index]));
  }
  emit("queue");
}

export function prev() {
  if (audio.currentTime > 4 || player.index <= 0) {
    audio.currentTime = 0;
    if (session) session.last = 0;
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
  audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
  if (session) session.last = audio.currentTime;
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
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        queue: player.queue.slice(Math.max(0, player.index - 50), player.index + 200),
        index: Math.min(player.index, 50),
        order: player.order.slice(0, 400),
        upNext: player.upNext,
        context: player.context,
        shuffle: player.shuffle,
        repeat: player.repeat,
        volume: player.volume,
        time: audio.currentTime || 0,
      }));
    } catch { /* ignore */ }
  }, 400);
}

export function restore() {
  let st;
  try { st = JSON.parse(localStorage.getItem(STATE_KEY) || "null"); } catch { st = null; }
  if (!st) return;
  player.shuffle = !!st.shuffle;
  player.repeat = st.repeat || "off";
  player.volume = typeof st.volume === "number" ? st.volume : 1;
  player.queue = (st.queue || []).filter((id) => getSong(id));
  player.order = (st.order || []).filter((id) => getSong(id));
  player.upNext = (st.upNext || []).filter((id) => getSong(id));
  player.context = st.context || player.context;
  player.index = Math.min(st.index || 0, player.queue.length - 1);
  const s = getSong(player.queue[player.index]);
  if (s) load(s, { autoplay: false, at: st.time > 5 ? st.time - 2 : 0 });
  emit("modes");
  emit("queue");
}

// ------------------------------------------------------------------ audio events
audio.addEventListener("timeupdate", () => {
  trackTime();
  emit("time", { t: audio.currentTime, d: audio.duration || player.current?.duration || 0 });
});
audio.addEventListener("seeked", () => { if (session) session.last = audio.currentTime; updatePositionState(); });
audio.addEventListener("play", () => {
  if (session) session.last = audio.currentTime;
  errorStreak = 0;
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  setClosingGuard(true);
  emit("state", { playing: true });
});
audio.addEventListener("pause", () => {
  trackTime();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  setClosingGuard(false);
  saveState();
  emit("state", { playing: false });
});
audio.addEventListener("waiting", () => emit("state", { playing: true, buffering: true }));
audio.addEventListener("playing", () => emit("state", { playing: true, buffering: false }));
audio.addEventListener("loadedmetadata", updatePositionState);
audio.addEventListener("ended", () => {
  trackTime();
  if (player.repeat === "one") {
    endSession(false);
    startSession(player.current);
    audio.currentTime = 0;
    play();
    return;
  }
  endSession(false);
  next(false);
});
audio.addEventListener("error", () => {
  const s = player.current;
  if (!s) return;
  // Signed release-asset URLs expire after a while: reload once at the same position.
  if (!reloadTried && audio.currentTime > 0) {
    reloadTried = true;
    const at = audio.currentTime;
    audio.src = s.src;
    audio.addEventListener("loadedmetadata", () => { audio.currentTime = at; play(); }, { once: true });
    return;
  }
  errorStreak += 1;
  emit("error", { song: s });
  if (errorStreak < 3) setTimeout(() => next(false), 1200);
});
setInterval(() => { if (!audio.paused) saveState(); }, 5000);
window.addEventListener("pagehide", () => { trackTime(); saveState(); endSession(false); });

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported */ } };
  set("play", play);
  set("pause", pause);
  set("previoustrack", prev);
  set("nexttrack", () => next(true));
  set("seekto", (d) => seek(d.seekTime));
  set("seekbackward", (d) => seek(audio.currentTime - (d.seekOffset || 10)));
  set("seekforward", (d) => seek(audio.currentTime + (d.seekOffset || 10)));
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
