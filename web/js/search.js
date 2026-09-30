// Search that understands Uzbek Latin/Cyrillic, Russian, typos and partial words.
import { GENRES, MOODS, LANGS, genre, mood } from "./i18n.js";

const CYR = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh",
  щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h", ә: "a", ө: "o",
  ү: "u", ң: "ng", і: "i",
};

export function norm(s) {
  if (!s) return "";
  let out = "";
  for (const ch of String(s).toLowerCase()) out += CYR[ch] ?? ch;
  return out
    .replace(/['`´ʻʼ‘’]/g, "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/kh/g, "x")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function trigrams(s) {
  const t = new Set();
  const p = `  ${s} `;
  for (let i = 0; i < p.length - 2; i++) t.add(p.slice(i, i + 3));
  return t;
}

export function trigramSim(a, b) {
  if (!a || !b) return 0;
  const A = trigrams(a), B = trigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Precomputes normalised fields on songs (call once after loading). */
export function indexSong(s) {
  s._t = norm(s.title);
  s._a = norm(s.artist);
  s._al = norm(s.album || "");
  // Genre / mood / language names in every site language, so "грустные" or "sad" both work.
  const all = (x) => (x ? Object.values(x) : []);
  const labels = [
    ...all(GENRES[s.genre]?.l), s.genre, s.subgenre, ...all(LANGS[s.language]),
    ...(s.moods || []).flatMap((m) => all(MOODS[m]?.l)), ...(s.tags || []),
  ];
  s._x = norm(labels.filter(Boolean).join(" "));
  s._all = `${s._t} ${s._a} ${s._al}`;
}

function scoreSong(s, q, words) {
  let score = 0;
  if (s._t === q) score = 100;
  else if (s._t.startsWith(q)) score = 90;
  else if (s._a === q) score = 85;
  else if (s._a.startsWith(q)) score = 80;
  else if (s._t.includes(q)) score = 70;
  else if (s._a.includes(q)) score = 65;
  else if (words.every((w) => s._all.split(" ").some((x) => x.startsWith(w)))) score = 60;
  else if (s._al.includes(q)) score = 45;
  else if (words.every((w) => s._x.includes(w))) score = 35;
  else {
    const sim = Math.max(trigramSim(q, s._t), trigramSim(q, s._a), trigramSim(q, `${s._a} ${s._t}`) * 0.95);
    if (sim >= 0.34) score = 25 + sim * 20;
  }
  return score;
}

export function searchSongs(songs, query) {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(" ");
  const res = [];
  for (const s of songs) {
    const sc = scoreSong(s, q, words);
    if (sc > 0) res.push([sc + Math.min(5, (s._plays || 0) / 4), s]);
  }
  res.sort((a, b) => b[0] - a[0]);
  return res.map((x) => x[1]);
}

export function searchArtists(artistNames, query) {
  const q = norm(query);
  if (!q) return [];
  const res = [];
  for (const name of artistNames) {
    const n = norm(name);
    let sc = 0;
    if (n === q) sc = 100;
    else if (n.startsWith(q)) sc = 80;
    else if (n.split(" ").some((w) => w.startsWith(q))) sc = 70;
    else if (n.includes(q)) sc = 60;
    else { const sim = trigramSim(q, n); if (sim >= 0.4) sc = 30 + sim * 20; }
    if (sc) res.push([sc, name]);
  }
  res.sort((a, b) => b[0] - a[0]);
  return res.map((x) => x[1]);
}

export function matchCategories(query) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  const hit = (x, key) => norm(key).startsWith(q) || Object.values(x.l).some((v) => norm(v).startsWith(q));
  for (const [key, g] of Object.entries(GENRES)) if (hit(g, key)) out.push({ type: "genre", key, ...genre(key) });
  for (const [key, m] of Object.entries(MOODS)) if (hit(m, key)) out.push({ type: "mood", key, ...mood(key) });
  return out.slice(0, 6);
}
