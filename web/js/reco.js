// Recommendation engine: a taste profile built from what you play, like and skip,
// content similarity between songs (artist, genre, mood, language, tags, energy)
// plus freshness, fatigue, time-of-day and a daily exploration seed.
import { lib, user, favSongs, recentlyPlayed } from "./store.js";

const DAY = 86_400_000;
const now = () => Date.now();

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}
const daySeed = () => new Date().toISOString().slice(0, 10);

function add(map, key, w) { if (key) map.set(key, (map.get(key) || 0) + w); }
function normalise(map) {
  let max = 0;
  for (const v of map.values()) max = Math.max(max, v);
  if (max > 0) for (const [k, v] of map) map.set(k, Math.max(0, v / max));
  return map;
}

/** The listener's taste, recomputed when plays/favourites change. */
export function profile() {
  const p = { artist: new Map(), genre: new Map(), mood: new Map(), lang: new Map(), tag: new Map(), energy: 0.6, weight: 0 };
  let eSum = 0, eW = 0;
  for (const s of lib.songs) {
    const n = user.plays[s.id] || 0;
    const fav = !!user.favs[s.id];
    const skips = user.skips[s.id] || 0;
    if (!n && !fav && !skips) continue;
    const last = user.last[s.id] || user.favs[s.id] || 0;
    const recency = 0.45 + 0.55 * Math.exp(-(now() - last) / (30 * DAY));
    let w = Math.log2(1 + n) * recency + (fav ? 2.5 : 0) - Math.min(2, skips * 0.4);
    if (w === 0) continue;
    for (const a of s.artists) add(p.artist, a, w);
    add(p.genre, s.genre, w);
    for (const m of s.moods || []) add(p.mood, m, w / (s.moods.length || 1));
    add(p.lang, s.language, w);
    for (const t of s.tags || []) add(p.tag, t, w / s.tags.length);
    if (w > 0) { eSum += (s.energy ?? 0.5) * w; eW += w; }
    p.weight += Math.max(0, w);
  }
  for (const k of ["artist", "genre", "mood", "lang", "tag"]) normalise(p[k]);
  if (eW) p.energy = eSum / eW;
  return p;
}

function avg(map, keys) {
  if (!keys || !keys.length) return 0;
  let s = 0;
  for (const k of keys) s += map.get(k) || 0;
  return s / keys.length;
}

/** Target energy for the current hour — calmer at night, livelier in the day. */
export function energyTarget(date = new Date()) {
  const h = date.getHours();
  if (h < 6) return 0.3;
  if (h < 10) return 0.55;
  if (h < 18) return 0.7;
  if (h < 22) return 0.6;
  return 0.4;
}

export function affinity(s, p) {
  if (p.weight < 0.5) return 0.5; // cold start: no opinion yet
  const artist = Math.max(0, ...s.artists.map((a) => p.artist.get(a) || 0));
  return 0.34 * artist + 0.2 * (p.genre.get(s.genre) || 0) + 0.15 * avg(p.mood, s.moods)
    + 0.1 * (p.lang.get(s.language) || 0) + 0.08 * avg(p.tag, s.tags)
    + 0.13 * (1 - Math.abs((s.energy ?? 0.5) - p.energy));
}

export function score(s, p, { explore = 0.1, context = true } = {}) {
  const t = now();
  let sc = affinity(s, p);
  const n = user.plays[s.id] || 0;
  const last = user.last[s.id] || 0;
  const added = Date.parse(s.addedAt || 0) || 0;
  if (!n) sc += 0.1; // never heard -> discovery bonus
  if (added && t - added < 7 * DAY) sc += 0.12 * (1 - (t - added) / (7 * DAY));
  if (last) {
    const ago = t - last;
    if (ago < 3 * 3600_000) sc -= 0.45;
    else if (ago < DAY) sc -= 0.18;
  }
  const skips = user.skips[s.id] || 0;
  if (skips && !user.favs[s.id]) sc -= Math.min(0.4, 0.12 * skips / Math.max(1, n));
  if (user.favs[s.id]) sc += 0.06;
  if (context) sc -= 0.12 * Math.abs((s.energy ?? 0.5) - energyTarget());
  sc += explore * hash(daySeed() + s.id);
  return sc;
}

/** Re-ranks so that the same artist doesn't dominate (MMR-style). */
export function diversify(ranked, limit = 30) {
  const pool = ranked.slice();
  const out = [];
  const artistCount = new Map();
  while (out.length < limit && pool.length) {
    let bestI = 0, best = -Infinity;
    for (let i = 0; i < Math.min(pool.length, 60); i++) {
      const { s, sc } = pool[i];
      const reps = Math.max(0, ...s.artists.map((a) => artistCount.get(a) || 0));
      const prev = out[out.length - 1];
      const val = sc * Math.pow(0.62, reps) - (prev && prev.genre === s.genre ? 0.02 : 0);
      if (val > best) { best = val; bestI = i; }
    }
    const [{ s }] = pool.splice(bestI, 1);
    out.push(s);
    for (const a of s.artists) artistCount.set(a, (artistCount.get(a) || 0) + 1);
  }
  return out;
}

const rank = (songs, p, opts) => songs.map((s) => ({ s, sc: score(s, p, opts) })).sort((a, b) => b.sc - a.sc);

export function forYou(limit = 30) {
  const p = profile();
  return diversify(rank(lib.songs, p), limit);
}

/** How alike two songs are (0..1). */
export function similarity(a, b) {
  if (a.id === b.id) return 0;
  const shared = a.artists.some((x) => b.artists.includes(x));
  const jac = (x = [], y = []) => {
    if (!x.length || !y.length) return 0;
    const Y = new Set(y);
    const inter = x.filter((v) => Y.has(v)).length;
    return inter / (x.length + y.length - inter);
  };
  let sim = (shared ? 0.34 : 0) + (a.genre === b.genre ? 0.2 : 0) + 0.15 * jac(a.moods, b.moods)
    + 0.1 * jac(a.tags, b.tags) + (a.language === b.language ? 0.1 : 0)
    + 0.08 * (1 - Math.abs((a.energy ?? 0.5) - (b.energy ?? 0.5)));
  if (a.year && b.year) sim += 0.03 * (1 - Math.min(1, Math.abs(a.year - b.year) / 15));
  return sim;
}

/** "Song radio": songs similar to a seed, personalised, excluding what just played. */
export function radio(seed, limit = 40, exclude = new Set()) {
  const p = profile();
  const ranked = lib.songs
    .filter((s) => s.id !== seed.id && !exclude.has(s.id))
    .map((s) => ({ s, sc: similarity(seed, s) * 1.6 + score(s, p, { explore: 0.08 }) * 0.5 }))
    .sort((a, b) => b.sc - a.sc);
  return diversify(ranked, limit);
}

export function similarArtists(name, limit = 10) {
  const mine = lib.byArtist.get(name) || [];
  if (!mine.length) return [];
  const scores = new Map();
  for (const [other, songs] of lib.byArtist) {
    if (other === name) continue;
    let total = 0;
    for (const a of mine.slice(0, 12)) for (const b of songs.slice(0, 12)) total += similarity(a, b);
    scores.set(other, total / (Math.min(12, mine.length) * Math.min(12, songs.length)));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).filter((x) => x[1] > 0.15).map((x) => x[0]);
}

// ------------------------------------------------------------------ mixes
export function dailyMixes(max = 6) {
  const p = profile();
  const byGenre = new Map();
  for (const s of lib.songs) {
    if (!byGenre.has(s.genre)) byGenre.set(s.genre, []);
    byGenre.get(s.genre).push(s);
  }
  // Order genres by taste (or size for new listeners).
  const genres = [...byGenre.keys()].sort((a, b) =>
    ((p.genre.get(b) || 0) * 10 + byGenre.get(b).length / 50) - ((p.genre.get(a) || 0) * 10 + byGenre.get(a).length / 50));
  const mixes = [];
  for (const g of genres) {
    const own = byGenre.get(g);
    if (own.length < 3) continue;
    const ranked = rank(own, p, { explore: 0.15, context: false });
    // Sprinkle in similar songs from other genres
    const seed = ranked[0].s;
    const extra = lib.songs.filter((s) => s.genre !== g && similarity(seed, s) > 0.35)
      .map((s) => ({ s, sc: score(s, p, { explore: 0.15, context: false }) - 0.2 }));
    const songs = diversify([...ranked, ...extra].sort((a, b) => b.sc - a.sc), 30);
    mixes.push({ id: `daily${mixes.length + 1}`, genre: g, songs });
    if (mixes.length >= max) break;
  }
  if (!mixes.length && lib.songs.length) mixes.push({ id: "daily1", genre: null, songs: forYou(30) });
  return mixes;
}

export function moodMix(m, limit = 50) {
  const p = profile();
  return diversify(rank(lib.songs.filter((s) => (s.moods || []).includes(m)), p, { explore: 0.1, context: false }), limit);
}

export function discover(limit = 30) {
  const p = profile();
  const fresh = lib.songs.filter((s) => !(user.plays[s.id] > 0));
  return diversify(rank(fresh, p, { explore: 0.2 }), limit);
}

export function onRepeat(limit = 30) {
  const since = now() - 30 * DAY;
  const counts = new Map();
  for (const h of user.history) if (h.t >= since) counts.set(h.id, (counts.get(h.id) || 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])
    .map(([id]) => lib.byId.get(id)).filter(Boolean).slice(0, limit);
}

export function forgotten(limit = 30) {
  const cutoff = now() - 21 * DAY;
  const loved = new Set(favSongs().map((s) => s.id));
  return lib.songs
    .filter((s) => (loved.has(s.id) || (user.plays[s.id] || 0) >= 3) && (user.last[s.id] || 0) < cutoff)
    .sort((a, b) => (user.plays[b.id] || 0) - (user.plays[a.id] || 0))
    .slice(0, limit);
}

export function topSongs(limit = 50) {
  return lib.songs.filter((s) => user.plays[s.id] > 0)
    .sort((a, b) => (user.plays[b.id] - user.plays[a.id]) || ((user.last[b.id] || 0) - (user.last[a.id] || 0)))
    .slice(0, limit);
}

export function topArtists(limit = 10) {
  const m = new Map();
  for (const s of lib.songs) {
    const n = user.plays[s.id] || 0;
    if (n) for (const a of s.artists) m.set(a, (m.get(a) || 0) + n);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function newest(limit = 30) {
  return lib.songs.slice().sort((a, b) => Date.parse(b.addedAt || 0) - Date.parse(a.addedAt || 0)).slice(0, limit);
}

/** Artists ordered by how much you like them (or by catalogue size). */
export function artistsRanked(limit = 20) {
  const p = profile();
  return [...lib.byArtist.entries()]
    .map(([name, songs]) => [name, (p.artist.get(name) || 0) * 5 + songs.length / 20 + hash(daySeed() + name) * 0.2])
    .sort((a, b) => b[1] - a[1]).slice(0, limit).map((x) => x[0]);
}

/** Short list for the "quick picks" grid at the top of Home. */
export function quickPicks(limit = 6) {
  const out = [];
  const seen = new Set();
  for (const s of [...recentlyPlayed(limit), ...forYou(limit * 2)]) {
    if (!seen.has(s.id)) { seen.add(s.id); out.push(s); }
    if (out.length >= limit) break;
  }
  return out;
}
