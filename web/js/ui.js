// Small DOM toolkit + shared components (icons, rows, cards, sheets, toast).
import { coverUrl, isFav, toggleFav, plays, emit, artistImage, lib, songsOf } from "./store.js";
import { player, playSong, playRadio, playNext, addToQueue, isPlaying, isPreview } from "./player.js";
import { t, fmtNum, fmtCompact, fmtDate, fmtDateShort, LANG } from "./i18n.js";
import { haptic, shareLink, canDownload, download } from "./tg.js";
import { CONFIG } from "./config.js";

// ------------------------------------------------------------------ icons (Lucide-style, MIT)
const STROKE = {
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  shuffle: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  repeat1: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  queue: '<path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  addQueue: '<path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/>',
  playNext: '<path d="M16 12H3"/><path d="M16 18H3"/><path d="M10 6H3"/><path d="M21 18V8a2 2 0 0 0-2-2h-5"/><path d="m16 8-2-2 2-2"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  disc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  note: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  sort: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
};
const FILL = {
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>',
  pause: '<rect x="5.5" y="4" width="4.5" height="16" rx="1.2"/><rect x="14" y="4" width="4.5" height="16" rx="1.2"/>',
  next: '<path d="M5 5.5v13a1 1 0 0 0 1.52.85L16 13.5V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.5L6.52 4.65A1 1 0 0 0 5 5.5z"/>',
  prev: '<path d="M19 5.5v13a1 1 0 0 1-1.52.85L8 13.5V18a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v4.5l9.48-5.85A1 1 0 0 1 19 5.5z"/>',
  more: '<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>',
  heartFill: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  homeFill: '<path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2h-5v-7a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v7H5a2 2 0 0 1-2-2z"/>',
};

export function icon(name, size = 24, extraClass = "") {
  const filled = name in FILL;
  const body = FILL[name] || STROKE[name] || "";
  const attrs = filled
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" ${attrs} aria-hidden="true">${body}</svg>`;
}

// ------------------------------------------------------------------ DOM
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function go(path) {
  const hash = path.startsWith("#") ? path : `#/${path.replace(/^\//, "")}`;
  afterOverlays(() => { if (location.hash !== hash) location.hash = hash; });
}

// ------------------------------------------------------------------ formatting
export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtLong(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return t("dur.hm", { h, m });
  if (m) return t("dur.m", { m });
  return t("dur.s", { s: sec });
}

export function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return t("time.now");
  if (d < 3600) return t("time.min", { n: Math.floor(d / 60) });
  if (d < 86400) return t("time.hour", { n: Math.floor(d / 3600) });
  if (d < 86400 * 7) return t("time.day", { n: Math.floor(d / 86400) });
  return fmtDateShort(new Date(ts));
}

export const num = fmtNum;

// ------------------------------------------------------------------ verified badge
/** A symmetric scalloped seal: n round lobes on a circle, computed so every lobe is identical. */
function sealPath(n = 8, r0 = 9.2, ra = 4, c = 12) {
  let d = "";
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = (c + r0 * Math.cos(a)).toFixed(3), y = (c + r0 * Math.sin(a)).toFixed(3);
    d += i ? ` A${ra} ${ra} 0 0 1 ${x} ${y}` : `M${x} ${y}`;
  }
  return `${d} Z`;
}
const SEAL = sealPath();
const sealSvg = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path fill="var(--verified)" d="${SEAL}"/><path d="M8.2 12.3l2.6 2.6 5-5.3" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Blue seal next to officially verified artists. Tapping it explains why the artist is verified. */
export function verifiedBadge(name, size = 16) {
  if (!lib.artists[name]?.verified) return null;
  const el = h("span", { class: "verified", role: "button", tabindex: "0", title: t("common.verified"), "aria-label": t("common.verified"), html: sealSvg(size) });
  const open = (e) => { e.preventDefault(); e.stopPropagation(); haptic("light"); openArtistInfo(name); };
  el.addEventListener("click", open);
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") open(e); });
  return el;
}

const pick = (obj) => (obj ? obj[LANG] || obj.en || obj.ru || Object.values(obj)[0] || "" : "");

/** Half-screen sheet: who the artist is, why they're verified on the station, numbers, official pages. */
export function openArtistInfo(name) {
  const p = lib.artists[name] || {};
  const songs = songsOf(name);
  const myPlays = songs.reduce((a, s) => a + plays(s.id), 0);
  const here = decodeURIComponent(location.hash) === `#/artist/${name}`;
  openSheet((sheet) => {
    // Opens at half the screen; scrolling inside it pulls it up to full height.
    sheet.classList.add("info-sheet");
    sheet.addEventListener("scroll", () => { if (sheet.scrollTop > 8) sheet.classList.add("full"); }, { passive: true });
    const stat = (value, label) => h("div", { class: "vi-stat" }, h("b", null, value), h("span", null, label));
    const check = (text, href) => h("li", null, h("span", { class: "vi-tick", html: icon("check", 14) }),
      href ? h("a", { href, target: "_blank", rel: "noopener" }, text, " ↗") : h("span", null, text));
    const desc = pick(p.desc);
    const body = [
      h("div", { class: "vi-head" },
        artistArt(name, "vi-photo"),
        h("div", { class: "vi-name" },
          h("h2", null, h("span", null, name), p.verified ? h("span", { class: "verified", html: sealSvg(22) }) : null),
          h("div", { class: p.verified ? "vi-kicker" : "vi-kicker plain" }, p.verified ? t("common.verified") : t("common.artist")),
          desc ? h("div", { class: "vi-desc" }, desc) : null)),
      h("div", { class: "vi-stats" },
        stat(fmtNum(songs.length), t("vi.songs", { app: CONFIG.appName })),
        myPlays ? stat(fmtNum(myPlays), t("vi.plays")) : null,
        p.fans ? stat(fmtCompact(p.fans), t("vi.fans")) : null,
        p.albums ? stat(fmtNum(p.albums), t("vi.albums")) : null),
    ];
    if (p.verified) {
      const checks = [];
      if (p.deezer) checks.push(check(t("vi.deezer"), p.deezer));
      if (p.apple) checks.push(check(t("vi.apple"), p.apple));
      if ((p.deezer || p.apple) && !p.manual) checks.push(check(t("vi.match")));
      if (p.manual) checks.push(check(t("vi.owner")));
      const since = p.verifiedAt ? new Date(p.verifiedAt) : null;
      body.push(
        h("h3", { class: "vi-h" }, t("vi.why")),
        h("p", { class: "vi-p" }, t("vi.intro", { app: CONFIG.appName })),
        h("ul", { class: "vi-checks" }, checks),
        since && !isNaN(since) ? h("p", { class: "vi-since" }, t("vi.since", { date: fmtDate(since) })) : null);
    }
    const bio = pick(p.bio);
    if (bio) {
      const wiki = pick(p.wiki);
      body.push(
        h("h3", { class: "vi-h" }, t("vi.about")),
        h("p", { class: "vi-bio" }, bio),
        h("p", { class: "vi-src" }, wiki ? h("a", { href: wiki, target: "_blank", rel: "noopener" }, t("vi.source")) : t("vi.source"),
          (p.bioTr || []).includes(LANG) ? ` · ${t("vi.translated")}` : ""));
    }
    const links = [["deezer", "Deezer"], ["apple", "Apple Music"]].filter(([k]) => p[k]);
    if (links.length && !p.verified) {
      body.push(h("div", { class: "chips vi-links" }, links.map(([k, label]) => h("a", { class: "chip", href: p[k], target: "_blank", rel: "noopener" }, `↗ ${label}`))));
    }
    if (!here && songs.length) body.push(h("button", { class: "btn vi-open", onclick: () => go(`artist/${encodeURIComponent(name)}`) }, t("vi.open")));
    append(sheet, [h("div", { class: "vi" }, body)]);
  });
}

// ------------------------------------------------------------------ art
function seedColors(seed) {
  let x = 0;
  for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  const h1 = x % 360, h2 = (h1 + 40 + (x >> 8) % 80) % 360;
  return [`hsl(${h1} 55% 42%)`, `hsl(${h2} 60% 22%)`];
}

export function placeholder(seed, cls = "", iconName = "note") {
  const [c1, c2] = seedColors(seed);
  return h("div", { class: `ph ${cls}`, style: { "--c1": c1, "--c2": c2 }, html: icon(iconName) });
}

export function art(s, cls = "") {
  const url = coverUrl(s);
  if (!url) return placeholder(s.id || s.title, cls);
  const img = h("img", { class: cls, src: url, alt: "", loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => img.replaceWith(placeholder(s.id, cls)), { once: true });
  return img;
}

export function artistArt(name, cls = "") {
  const url = artistImage(name);
  if (!url) return placeholder(name, cls, "user");
  const img = h("img", { class: cls, src: url, alt: "", loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => img.replaceWith(placeholder(name, cls, "user")), { once: true });
  return img;
}

export function collage(songs, cls = "") {
  const withArt = [];
  const seen = new Set();
  for (const s of songs) {
    const u = coverUrl(s);
    if (u && !seen.has(u)) { seen.add(u); withArt.push(s); }
    if (withArt.length === 4) break;
  }
  if (withArt.length < 4) return h("div", { class: `collage one ${cls}` }, songs[0] ? art(withArt[0] || songs[0]) : placeholder("mix"));
  return h("div", { class: `collage ${cls}` }, withArt.map((s) => art(s)));
}

export function likedArt(cls = "") {
  return h("div", { class: `liked-art ${cls}`, html: icon("heartFill", 48) });
}

// ------------------------------------------------------------------ rows & cards
const eq = () => h("span", { class: `eq${isPlaying() ? "" : " paused"}` }, h("i"), h("i"), h("i"));

export function heartButton(s, size = 22) {
  const b = h("button", { class: `icon-btn heart${isFav(s.id) ? " liked" : ""}`, "aria-label": t("common.like"), dataset: { fav: s.id } });
  b.innerHTML = icon(isFav(s.id) ? "heartFill" : "heart", size);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    const fav = toggleFav(s.id);
    haptic(fav ? "success" : "light");
    toast(fav ? t("toast.faved") : t("toast.unfaved"));
  });
  return b;
}

/**
 * A track row. opts: { index, list, context, cover(bool), showPlays(bool), sub }
 * Clicking plays the song within `list` (the surrounding collection).
 */
export function songRow(s, opts = {}) {
  const playing = player.current?.id === s.id;
  const lead = opts.index != null
    ? h("div", { class: "num" }, String(opts.index + 1), eq())
    : h("div", { class: "cov-wrap" }, art(s, "cov"), eq());
  const n = plays(s.id);
  const row = h("div", { class: `row${playing ? " playing" : ""}`, dataset: { id: s.id }, role: "button" },
    lead,
    h("div", { class: "meta" },
      h("div", { class: "t" }, h("span", null, s.title)),
      h("div", { class: "s" },
        s.explicit ? h("span", { class: "badge" }, "E") : null,
        isPreview(s) ? h("span", { class: "badge pv", title: t("preview.note") }, t("preview.badge")) : null,
        opts.sub ?? [s.artist, verifiedBadge(s.artists?.[0], 13)])),
    opts.showPlays !== false ? h("div", { class: "extra plays" }, n ? `${num(n)} ▶` : "") : null,
    heartButton(s, 20),
    h("div", { class: "extra" }, fmtTime(s.duration)),
    h("button", { class: "icon-btn more", "aria-label": t("common.more"), html: icon("more", 20),
      onclick: (e) => { e.stopPropagation(); songMenu(s, opts); } }),
  );
  row.addEventListener("click", () => {
    haptic("light");
    if (opts.onClick) opts.onClick(s);
    else playSong(s, opts.list, opts.context);
  });
  return row;
}

export function card({ artEl, title, sub, onClick, onPlay, round = false, playing = false, badge = null }) {
  const el = h("div", { class: `card${round ? " round" : ""}${playing ? " playing" : ""}`, role: "button" },
    h("div", { class: "art" }, artEl, badge,
      onPlay ? h("button", { class: "play-fab", "aria-label": t("common.play"), html: icon("play", 22),
        onclick: (e) => { e.stopPropagation(); haptic("medium"); onPlay(); } }) : null),
    h("div", { class: "t" }, title),
    sub ? h("div", { class: "s" }, sub) : null);
  el.addEventListener("click", onClick);
  return el;
}

export function section(title, content, { sub, more } = {}) {
  return h("section", { class: "section" },
    h("div", { class: "section-head" },
      h("div", null, h("h2", null, title), sub ? h("div", { class: "sub" }, sub) : null),
      more ? h("a", { href: more }, t("common.all")) : null),
    content);
}

/** Renders a long list progressively (keeps huge libraries fast). */
export function lazyList(container, items, render, page = 60) {
  let i = 0;
  const sentinel = h("div", { style: { height: "1px" } });
  const more = () => {
    const frag = document.createDocumentFragment();
    for (const end = Math.min(items.length, i + page); i < end; i++) frag.append(render(items[i], i));
    container.append(frag);
    if (i >= items.length) { io.disconnect(); sentinel.remove(); }
    else container.append(sentinel);
  };
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { rootMargin: "600px" });
  more();
  if (i < items.length) io.observe(sentinel);
  return container;
}

/** An in-app link that also closes any open overlay first. */
export function link(path, attrs, ...children) {
  return h("a", { ...attrs, href: `#/${path}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); go(path); } }, ...children);
}

/** Update "now playing" highlighting and hearts in whatever is on screen. */
export function refreshMarks(root = document) {
  const cur = player.current?.id;
  const playing = isPlaying();
  root.querySelectorAll(".row[data-id]").forEach((r) => r.classList.toggle("playing", r.dataset.id === cur));
  root.querySelectorAll(".eq").forEach((e) => e.classList.toggle("paused", !playing));
  root.querySelectorAll("[data-fav]").forEach((b) => {
    const f = isFav(b.dataset.fav);
    b.classList.toggle("liked", f);
    b.innerHTML = icon(f ? "heartFill" : "heart", b.querySelector("svg")?.getAttribute("width") || 22);
  });
}

// ------------------------------------------------------------------ overlays (sheet, full player) + back button
// Each overlay adds a history entry, so the browser/Telegram back button closes it.
const stack = [];

export function pushOverlay(close) {
  stack.push(close);
  history.pushState({ overlay: stack.length }, "");
  emit("overlay", stack.length);
}

export function popOverlay() {
  if (stack.length) history.back();
}

/** Closes every open overlay, then runs fn. */
export function afterOverlays(fn) {
  if (!stack.length) { fn(); return; }
  const n = stack.length;
  const onPop = () => {
    if (stack.length) return;
    window.removeEventListener("popstate", onPop);
    setTimeout(fn, 0);
  };
  window.addEventListener("popstate", onPop);
  history.go(-n);
}

window.addEventListener("popstate", (e) => {
  const depth = e.state?.overlay || 0;
  let changed = false;
  while (stack.length > depth) { stack.pop()(); changed = true; }
  if (changed) emit("overlay", stack.length);
});

export const overlayOpen = () => stack.length > 0;

/** In-app page history depth (kept up to date by the router). */
export const nav = { depth: 0 };

/** Back: close an overlay, else previous page, else Home (when the app was opened on a deep link). */
export function back() {
  if (overlayOpen()) popOverlay();
  else if (nav.depth > 1) history.back();
  else go("home");
}

// ------------------------------------------------------------------ toast
let toastTimer = null;
export function toast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// ------------------------------------------------------------------ bottom sheet
export function openSheet(build) {
  const root = document.getElementById("sheet-root");
  const backdrop = h("div", { class: "sheet-backdrop" });
  const sheet = h("div", { class: "sheet", role: "dialog" }, h("div", { class: "sheet-grip" }));
  const close = () => {
    sheet.classList.remove("open");
    backdrop.classList.remove("open");
    setTimeout(() => { sheet.remove(); backdrop.remove(); }, 280);
  };
  const dismiss = () => popOverlay();
  build(sheet, dismiss);
  backdrop.addEventListener("click", dismiss);
  root.append(backdrop, sheet);
  requestAnimationFrame(() => { backdrop.classList.add("open"); sheet.classList.add("open"); });
  pushOverlay(close);
  return dismiss;
}

export function sheetItem(iconName, label, onClick, cls = "") {
  return h("button", { class: `sheet-item ${cls}`, html: `${icon(iconName, 22)}<span>${esc(label)}</span>`, onclick: onClick });
}

export function siteUrl() {
  return location.href.split("#")[0].split("?")[0];
}

let shareImpl = null;
/** The app plugs in the full share sheet (story cards etc.); this is the plain fallback. */
export function setShareImpl(fn) { shareImpl = fn; }

export function shareSong(s) {
  if (shareImpl) { shareImpl(s); return; }
  const url = `${siteUrl()}#/song/${s.id}`;
  const text = `🎵 ${s.artist} — ${s.title}`;
  if (!shareLink(url, text)) {
    navigator.clipboard?.writeText(url).then(() => toast(t("toast.copied")), () => toast(url, 4000));
  }
}

export function downloadSong(s) {
  const ext = (s.src.split("?")[0].match(/\.\w+$/) || [".mp3"])[0];
  const name = `${s.artist} - ${s.title}${ext}`.replace(/[\\/:*?"<>|]+/g, " ");
  download(new URL(s.src, location.href).href, name);
  toast(t("toast.downloading"));
}

export function songMenu(s, opts = {}) {
  openSheet((sheet, dismiss) => {
    const act = (fn) => () => { dismiss(); setTimeout(fn, 120); };
    append(sheet, [
      h("div", { class: "sheet-head" }, art(s), h("div", { style: { minWidth: 0 } }, h("b", null, s.title), h("span", null, s.artist))),
      sheetItem(isFav(s.id) ? "heartFill" : "heart", isFav(s.id) ? t("menu.removeFav") : t("menu.addFav"),
        act(() => { const f = toggleFav(s.id); toast(f ? t("toast.faved") : t("toast.unfaved")); }), isFav(s.id) ? "accent" : ""),
      sheetItem("playNext", t("menu.playNext"), act(() => { playNext(s); toast(t("toast.playNext")); })),
      sheetItem("addQueue", t("menu.addQueue"), act(() => { addToQueue(s); toast(t("toast.queued")); })),
      sheetItem("radio", t("menu.radio"), act(() => playRadio(s))),
      ...s.artists.map((a) => sheetItem("user", t("menu.artist", { a }), act(() => go(`artist/${encodeURIComponent(a)}`)))),
      sheetItem("info", t("menu.about"), act(() => go(`song/${s.id}`))),
      sheetItem("share", t("common.share"), act(() => shareSong(s))),
      canDownload() && s.src && !isPreview(s) ? sheetItem("download", t("common.download"), act(() => downloadSong(s))) : null,
    ]);
  });
}

export { CONFIG };
