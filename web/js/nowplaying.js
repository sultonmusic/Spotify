// Full-screen "Now playing" view with synced lyrics, song info and the queue.
import { on, plays, coverUrl } from "./store.js";
import { player, toggle, next, prev, seek, setShuffle, cycleRepeat, isPlaying, upcoming, jumpTo, removeUpNext } from "./player.js";
import { h, icon, art, fmtTime, heartButton, songMenu, shareSong, link, pushOverlay, popOverlay, openSheet, songRow, timeAgo, num } from "./ui.js";
import { genre, mood, lang } from "./i18n.js";
import { haptic } from "./tg.js";

const lyricsCache = new Map();
export async function getLyrics(s) {
  if (!s?.lyrics) return null;
  if (lyricsCache.has(s.id)) return lyricsCache.get(s.id);
  try {
    const res = await fetch(`library/lyrics/${s.id}.json`, { cache: "force-cache" });
    const data = res.ok ? await res.json() : null;
    lyricsCache.set(s.id, data);
    return data;
  } catch { return null; }
}

export function rgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return `rgba(83,83,83,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

// ------------------------------------------------------------------ synced lyrics widget
export function lyricsView(container, data, { big = false } = {}) {
  container.innerHTML = "";
  if (!data) { container.append(h("div", { class: "muted" }, "Qo'shiq matni topilmadi")); return () => {}; }
  if (!data.synced) {
    container.append(h("div", { class: "lyrics-plain" }, data.plain || ""));
    return () => {};
  }
  const lines = data.synced.filter((l) => l[1] !== undefined);
  const els = lines.map(([t, text]) => h("div", { class: "lyric", onclick: () => { seek(t); haptic("select"); } }, text || "♪"));
  container.append(...els);
  let current = -1, userScrollUntil = 0;
  const pauseAuto = () => { userScrollUntil = Date.now() + 3500; };
  container.addEventListener("wheel", pauseAuto, { passive: true });
  container.addEventListener("touchmove", pauseAuto, { passive: true });
  const update = (t) => {
    let lo = 0, hi = lines.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid][0] <= t + 0.25) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    if (idx === current) return;
    current = idx;
    els.forEach((el, i) => { el.classList.toggle("active", i === idx); el.classList.toggle("past", i < idx); });
    if (idx >= 0 && Date.now() > userScrollUntil) {
      const el = els[idx];
      container.scrollTo({ top: el.offsetTop - container.clientHeight * (big ? 0.35 : 0.3), behavior: "smooth" });
    }
  };
  update(player.audio.currentTime);
  return update;
}

// ------------------------------------------------------------------ now playing overlay
const root = () => document.getElementById("nowplaying");
let isOpen = false;
let lyricsUpdate = () => {};
let fullLyricsUpdate = null;
let seeking = false;

export function openNowPlaying() {
  if (isOpen || !player.current) return;
  isOpen = true;
  render();
  const el = root();
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("open"));
  pushOverlay(() => {
    isOpen = false;
    el.classList.remove("open");
    setTimeout(() => { if (!isOpen) el.hidden = true; }, 350);
  });
}

function render() {
  const s = player.current;
  const el = root();
  el.innerHTML = "";
  if (!s) return;
  const color = s.color || "#535353";
  const playBtn = h("button", { class: "np-play", "aria-label": "Ijro/pauza", html: icon(isPlaying() ? "pause" : "play"), onclick: () => { haptic("medium"); toggle(); } });
  const range = h("input", { class: "range", type: "range", min: 0, max: 1000, value: 0, "aria-label": "Vaqt" });
  const tCur = h("span", null, "0:00"), tDur = h("span", null, fmtTime(s.duration));
  range.addEventListener("input", () => {
    seeking = true;
    const d = player.audio.duration || s.duration;
    tCur.textContent = fmtTime((range.value / 1000) * d);
    range.style.setProperty("--p", `${range.value / 10}%`);
  });
  range.addEventListener("change", () => { seek((range.value / 1000) * (player.audio.duration || s.duration)); seeking = false; });

  const shuffleBtn = h("button", { class: `icon-btn${player.shuffle ? " on" : " muted"}`, "aria-label": "Aralash", html: icon("shuffle"), onclick: () => { haptic("select"); setShuffle(!player.shuffle); } });
  const repeatBtn = h("button", { class: `icon-btn${player.repeat !== "off" ? " on" : " muted"}`, "aria-label": "Takrorlash", html: icon(player.repeat === "one" ? "repeat1" : "repeat"), onclick: () => { haptic("select"); cycleRepeat(); } });

  const lyricsBox = h("div", { class: "np-lyrics" }, h("div", { class: "spinner" }));
  const lyricsCard = s.lyrics ? h("div", { class: "np-card", style: { background: rgba(color, 0.9) } },
    h("h4", null, "Qo'shiq matni", h("button", { class: "link-btn", onclick: openFullLyrics }, "Kattalashtirish")),
    lyricsBox) : null;
  if (s.lyrics) getLyrics(s).then((data) => { if (player.current?.id === s.id) lyricsUpdate = lyricsView(lyricsBox, data); });
  else lyricsUpdate = () => {};

  const pills = [
    link(`genre/${encodeURIComponent(s.genre)}`, { class: "pill" }, genre(s.genre).emoji, " ", genre(s.genre).label),
    ...(s.moods || []).map((m) => link(`mood/${m}`, { class: "pill" }, mood(m).emoji, " ", mood(m).label)),
    h("span", { class: "pill" }, "🌐 ", lang(s.language)),
    s.bpm ? h("span", { class: "pill" }, `${s.bpm} BPM`) : null,
    s.year ? h("span", { class: "pill" }, `📅 ${s.year}`) : null,
  ];
  const about = h("div", { class: "np-card" },
    h("h4", null, "Qo'shiq haqida", link(`song/${s.id}`, { class: "link-btn" }, "Batafsil")),
    h("div", { class: "np-about" },
      s.description ? h("div", null, s.description) : null,
      s.album ? h("div", { class: "muted" }, `💿 ${s.album}${s.year ? ` · ${s.year}` : ""}`) : null,
      h("div", { class: "pills" }, pills)));

  const queueCard = h("div", { class: "np-card np-queue" });
  const renderQueue = () => {
    const { upNext, rest } = upcoming(5);
    queueCard.innerHTML = "";
    queueCard.append(h("h4", null, "Navbatda", h("button", { class: "link-btn", onclick: openQueue }, "Hammasi")));
    const items = [...upNext, ...rest].slice(0, 5);
    if (!items.length) queueCard.append(h("div", { class: "muted" }, "Navbat bo'sh — o'xshash qo'shiqlar avtomatik davom etadi"));
    items.forEach((q, n) => {
      queueCard.append(songRow(q, { showPlays: false, onClick: () => {
        if (n < upNext.length) { removeUpNext(n); player.queue.splice(player.index + 1, 0, q.id); jumpTo(player.index + 1); }
        else { const i = player.queue.indexOf(q.id, player.index + 1); if (i >= 0) jumpTo(i); }
      } }));
    });
  };
  renderQueue();

  const added = Date.parse(s.addedAt || 0);
  el.append(
    h("div", { class: "np-bg", style: { background: `linear-gradient(180deg, ${rgba(color, 0.95)} 0%, ${rgba(color, 0.55)} 40%, #121212 85%)` } }),
    h("div", { class: "np-inner" },
      h("div", { class: "np-head" },
        h("button", { class: "icon-btn", "aria-label": "Yopish", html: icon("down", 28), onclick: popOverlay }),
        h("div", { class: "ctx" }, h("small", null, contextKicker()), h("b", null, player.context.title || s.album || "")),
        h("button", { class: "icon-btn", "aria-label": "Ko'proq", html: icon("more"), onclick: () => songMenu(s) })),
      h("div", { class: `np-art${isPlaying() ? "" : " paused"}` }, art(s)),
      h("div", { class: "np-title-row" },
        h("div", { class: "txt" },
          h("div", { class: "np-title" }, s.title),
          h("div", { class: "np-artist" }, s.artists.map((a, i) => [i ? ", " : "", link(`artist/${encodeURIComponent(a)}`, null, a)]))),
        heartButton(s, 28)),
      h("div", { class: "np-seek" }, range, h("div", { class: "np-times" }, tCur, tDur)),
      h("div", { class: "np-controls" },
        shuffleBtn,
        h("button", { class: "icon-btn skip", "aria-label": "Oldingi", html: icon("prev"), onclick: () => { haptic("light"); prev(); } }),
        playBtn,
        h("button", { class: "icon-btn skip", "aria-label": "Keyingi", html: icon("next"), onclick: () => { haptic("light"); next(); } }),
        repeatBtn),
      h("div", { class: "np-bottom" },
        h("button", { class: "icon-btn", "aria-label": "Matn", html: icon("mic"), onclick: () => (s.lyrics ? openFullLyrics() : null), style: { opacity: s.lyrics ? 1 : 0.35 } }),
        h("button", { class: "icon-btn", "aria-label": "Ulashish", html: icon("share"), onclick: () => shareSong(s) }),
        h("button", { class: "icon-btn", "aria-label": "Navbat", html: icon("queue"), onclick: openQueue })),
      h("div", { class: "np-stats" },
        h("span", null, `▶ ${num(plays(s.id))} marta tinglangan`),
        added ? h("span", null, `➕ ${timeAgo(added)} qo'shilgan`) : null),
      lyricsCard, about, queueCard));

  el._update = { playBtn, range, tCur, tDur, shuffleBtn, repeatBtn, renderQueue, art: el.querySelector(".np-art") };
  updateTime();
}

function contextKicker() {
  const t = player.context.type;
  return { radio: "Radio", mix: "Miks", artist: "Ijrochi", genre: "Janr", mood: "Kayfiyat", liked: "Sevimlilar",
    search: "Qidiruv", autoplay: "Avtomatik davom", album: "Albom" }[t] || "Ijro etilmoqda";
}

function updateTime() {
  const u = root()._update;
  if (!u || seeking) return;
  const d = player.audio.duration || player.current?.duration || 0;
  const t = player.audio.currentTime || 0;
  const p = d ? (t / d) * 1000 : 0;
  u.range.value = p;
  u.range.style.setProperty("--p", `${p / 10}%`);
  u.tCur.textContent = fmtTime(t);
  u.tDur.textContent = fmtTime(d);
}

// ------------------------------------------------------------------ full-screen lyrics
function openFullLyrics() {
  const s = player.current;
  if (!s?.lyrics) return;
  const box = h("div", { class: "np-lyrics" }, h("div", { class: "spinner" }));
  const panel = h("div", { class: "lyrics-full", style: { background: rgba(s.color || "#535353", 1) } },
    h("div", { class: "np-head" },
      h("button", { class: "icon-btn", html: icon("down", 28), onclick: popOverlay }),
      h("div", { class: "ctx" }, h("b", null, s.title), h("small", { style: { textTransform: "none", letterSpacing: 0 } }, s.artist)),
      h("div", { style: { width: "40px" } })),
    box);
  document.body.append(panel);
  getLyrics(s).then((data) => { fullLyricsUpdate = lyricsView(box, data, { big: true }); });
  pushOverlay(() => { fullLyricsUpdate = null; panel.remove(); });
}

// ------------------------------------------------------------------ queue sheet
export function openQueue() {
  openSheet((sheet) => {
    const build = () => {
      sheet.querySelectorAll(".q").forEach((x) => x.remove());
      const box = h("div", { class: "q", style: { padding: "0 8px" } });
      const cur = player.current;
      if (cur) box.append(h("div", { class: "section-head", style: { padding: "4px 8px" } }, h("h2", { style: { fontSize: "17px" } }, "Hozir ijroda")), songRow(cur, { showPlays: false, onClick: toggle }));
      const { upNext, rest } = upcoming(60);
      if (upNext.length) {
        box.append(h("div", { class: "section-head", style: { padding: "14px 8px 4px" } }, h("h2", { style: { fontSize: "17px" } }, "Navbatingiz")));
        upNext.forEach((s, i) => box.append(songRow(s, { showPlays: false, onClick: () => {
          removeUpNext(i); player.queue.splice(player.index + 1, 0, s.id); jumpTo(player.index + 1);
        } })));
      }
      box.append(h("div", { class: "section-head", style: { padding: "14px 8px 4px" } },
        h("h2", { style: { fontSize: "17px" } }, `Keyingisi: ${player.context.title || "navbat"}`)));
      if (!rest.length) box.append(h("div", { class: "muted", style: { padding: "8px" } }, "Oxirida o'xshash qo'shiqlar avtomatik qo'shiladi ✨"));
      rest.forEach((s, i) => box.append(songRow(s, { showPlays: false, onClick: () => jumpTo(player.index + 1 + i) })));
      sheet.append(box);
    };
    build();
    const off = on("queue", () => { if (sheet.isConnected) build(); else off(); });
  });
}

// ------------------------------------------------------------------ events
on("track", () => { if (isOpen) render(); });
on("time", ({ t }) => {
  if (isOpen) { updateTime(); lyricsUpdate(t); }
  if (fullLyricsUpdate) fullLyricsUpdate(t);
});
on("state", ({ playing }) => {
  const u = root()._update;
  if (!u) return;
  u.playBtn.innerHTML = icon(playing ? "pause" : "play");
  u.art?.classList.toggle("paused", !playing);
});
on("modes", () => {
  const u = root()._update;
  if (!u) return;
  u.shuffleBtn.className = `icon-btn${player.shuffle ? " on" : " muted"}`;
  u.repeatBtn.className = `icon-btn${player.repeat !== "off" ? " on" : " muted"}`;
  u.repeatBtn.innerHTML = icon(player.repeat === "one" ? "repeat1" : "repeat");
});
on("queue", () => { const u = root()._update; if (isOpen && u) u.renderQueue(); });

export { coverUrl };
