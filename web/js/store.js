// Library (songs.json) + the listener's personal data (plays, favourites, history).
// Personal data lives in localStorage and, inside Telegram, is synced across the
// user's devices with Telegram CloudStorage.
import { CONFIG } from "./config.js";
import { indexSong } from "./search.js";
import { cloud, cloudAvailable } from "./tg.js";

// ------------------------------------------------------------------ events
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  for (const fn of listeners.get(evt) || []) {
    try { fn(data); } catch (e) { console.error(e); }
  }
}

// ------------------------------------------------------------------ library
export const lib = { songs: [], byId: new Map(), byArtist: new Map(), artists: {}, updatedAt: null, loaded: false };

export async function loadLibrary() {
  const res = await fetch(`${CONFIG.library}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`songs.json: HTTP ${res.status}`);
  const data = await res.json();
  if (lib.loaded && data.updatedAt === lib.updatedAt) return [];
  const known = new Set(lib.byId.keys());
  lib.songs = (data.songs || []).filter((s) => s && s.id && s.src);
  lib.artists = data.artists || {};
  lib.updatedAt = data.updatedAt;
  lib.byId = new Map();
  lib.byArtist = new Map();
  for (const s of lib.songs) {
    if (!s.artists || !s.artists.length) s.artists = [s.artist];
    indexSong(s);
    s._plays = user.plays[s.id] || 0;
    lib.byId.set(s.id, s);
    for (const a of s.artists) {
      if (!lib.byArtist.has(a)) lib.byArtist.set(a, []);
      lib.byArtist.get(a).push(s);
    }
  }
  const added = lib.loaded ? lib.songs.filter((s) => !known.has(s.id)) : [];
  lib.loaded = true;
  emit("library", { added });
  return added;
}

export const song = (id) => lib.byId.get(id);
export const songsOf = (artist) => lib.byArtist.get(artist) || [];
export const artistNames = () => [...lib.byArtist.keys()];

export function coverUrl(s) {
  if (!s?.cover) return null;
  return s.coverV ? `${s.cover}?v=${s.coverV}` : s.cover;
}

export function artistImage(name) {
  const a = lib.artists[name];
  if (a?.image) return a.image;
  const withCover = songsOf(name).find((s) => s.cover);
  return withCover ? coverUrl(withCover) : null;
}

export function artistColor(name) {
  return lib.artists[name]?.color || songsOf(name).find((s) => s.color)?.color || "#535353";
}

// ------------------------------------------------------------------ user data
const LS_KEY = "ms.user.v1";

function blankUser() {
  return { plays: {}, last: {}, skips: {}, favs: {}, favTs: 0, history: [], listen: 0, since: Date.now() };
}

function loadUser() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...blankUser(), ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return blankUser();
}

export const user = loadUser();

let saveTimer = null;
function saveUser() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(user)); } catch { /* full or blocked */ }
    pushSoon();
  }, 600);
}

export const isFav = (id) => !!user.favs[id];
export const plays = (id) => user.plays[id] || 0;

export function toggleFav(id) {
  const fav = !user.favs[id];
  if (fav) user.favs[id] = Date.now();
  else delete user.favs[id];
  user.favTs = Date.now();
  saveUser();
  emit("favs", { id, fav });
  return fav;
}

export function favSongs() {
  return Object.entries(user.favs)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => lib.byId.get(id))
    .filter(Boolean);
}

export function recordPlay(id) {
  user.plays[id] = (user.plays[id] || 0) + 1;
  user.last[id] = Date.now();
  user.history.unshift({ id, t: Date.now() });
  if (user.history.length > 400) user.history.length = 400;
  const s = lib.byId.get(id);
  if (s) s._plays = user.plays[id];
  saveUser();
  emit("plays", { id, count: user.plays[id] });
}

export function recordSkip(id) {
  user.skips[id] = (user.skips[id] || 0) + 1;
  saveUser();
}

export function addListenTime(seconds) {
  if (seconds > 0 && seconds < 36000) { user.listen += seconds; saveUser(); }
}

/** Unique songs from listening history, most recent first. */
export function recentlyPlayed(limit = 20) {
  const seen = new Set();
  const out = [];
  for (const h of user.history) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    const s = lib.byId.get(h.id);
    if (s) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export function totalPlays() {
  return Object.values(user.plays).reduce((a, b) => a + b, 0);
}

// ------------------------------------------------------------------ cloud sync (Telegram)
const CHUNK = 3900;
const b36 = (n) => Math.max(0, Math.floor(n)).toString(36);
const unb36 = (s) => parseInt(s, 36) || 0;
let lastPushed = {};
let pushTimer = null;
let pulled = false;

function chunk(prefix, entries, out) {
  let i = 0, cur = "";
  for (const e of entries) {
    if (cur && cur.length + e.length + 1 > CHUNK) { out[prefix + i++] = cur; cur = ""; }
    cur = cur ? `${cur},${e}` : e;
  }
  if (cur) out[prefix + i] = cur;
}

function snapshot() {
  const out = { m: JSON.stringify({ ft: user.favTs, ls: Math.round(user.listen), since: user.since }) };
  chunk("p", Object.entries(user.plays).map(([id, n]) => `${id}:${b36(n)}:${b36((user.last[id] || 0) / 1000)}`), out);
  chunk("s", Object.entries(user.skips).map(([id, n]) => `${id}:${b36(n)}`), out);
  chunk("f", Object.entries(user.favs).map(([id, t]) => `${id}:${b36(t / 1000)}`), out);
  chunk("h", user.history.slice(0, 120).map((h) => `${h.id}:${b36(h.t / 1000)}`), out);
  return out;
}

function entries(data, prefix) {
  return Object.keys(data)
    .filter((k) => new RegExp(`^${prefix}\\d+$`).test(k))
    .flatMap((k) => (data[k] || "").split(",").filter(Boolean).map((e) => e.split(":")));
}

async function pull() {
  if (!cloudAvailable()) return;
  try {
    const keys = (await cloud.keys()).filter((k) => /^(m|[psfh]\d+)$/.test(k));
    const data = await cloud.getMany(keys);
    const meta = data.m ? JSON.parse(data.m) : {};
    for (const [id, n, t] of entries(data, "p")) {
      user.plays[id] = Math.max(user.plays[id] || 0, unb36(n));
      user.last[id] = Math.max(user.last[id] || 0, unb36(t) * 1000);
    }
    for (const [id, n] of entries(data, "s")) user.skips[id] = Math.max(user.skips[id] || 0, unb36(n));
    if ((meta.ft || 0) > (user.favTs || 0)) {
      user.favs = {};
      for (const [id, t] of entries(data, "f")) user.favs[id] = unb36(t) * 1000;
      user.favTs = meta.ft;
    }
    const seen = new Set(user.history.map((h) => `${h.id}:${Math.floor(h.t / 1000)}`));
    for (const [id, t] of entries(data, "h")) {
      const k = `${id}:${unb36(t)}`;
      if (!seen.has(k)) { seen.add(k); user.history.push({ id, t: unb36(t) * 1000 }); }
    }
    user.history.sort((a, b) => b.t - a.t);
    user.history.length = Math.min(user.history.length, 400);
    user.listen = Math.max(user.listen || 0, meta.ls || 0);
    if (meta.since) user.since = Math.min(user.since, meta.since);
    lastPushed = data;
    pulled = true;
    for (const s of lib.songs) s._plays = user.plays[s.id] || 0;
    try { localStorage.setItem(LS_KEY, JSON.stringify(user)); } catch { /* ignore */ }
    emit("user", {});
    pushSoon();
  } catch (e) {
    console.warn("cloud pull failed", e);
    pulled = true;
  }
}

async function push() {
  if (!cloudAvailable() || !pulled) return;
  const next = snapshot();
  try {
    for (const [k, v] of Object.entries(next)) {
      if (lastPushed[k] !== v) await cloud.set(k, v);
    }
    const stale = Object.keys(lastPushed).filter((k) => !(k in next));
    if (stale.length) await cloud.remove(stale);
    lastPushed = next;
  } catch (e) {
    console.warn("cloud push failed", e);
  }
}

function pushSoon() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 3000);
}

export function initSync() {
  pull();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      try { localStorage.setItem(LS_KEY, JSON.stringify(user)); } catch { /* ignore */ }
      push();
    }
  });
}
