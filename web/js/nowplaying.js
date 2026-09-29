// Full-screen "Now playing" view with synced lyrics, song info and the queue.
import { on, plays, coverUrl, lib } from "./store.js";
import {
  player, toggle, next, prev, seek, setShuffle, cycleRepeat, isPlaying, upcoming, jumpTo, removeUpNext,
  currentTime, duration,
} from "./player.js";
import { h, icon, art, fmtTime, heartButton, songMenu, link, pushOverlay, popOverlay, openSheet, songRow, timeAgo, verifiedBadge, toast } from "./ui.js";
import { genre, mood, lang, t, describe, LANG } from "./i18n.js";
import { openShare, openStory } from "./share.js";
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
const TR_KEY = "ms.tr";
export const trEnabled = () => { try { return localStorage.getItem(TR_KEY) !== "0"; } catch { return true; } };
export function setTrEnabled(on) { try { localStorage.setItem(TR_KEY, on ? "1" : "0"); } catch { /* ignore */ } }

/** Translation lines for the site language (null when the song is already in it or none exist). */
export function translationFor(song, data) {
  if (!data?.tr || !song || song.language === LANG) return null;
  return data.tr[LANG] || null;
}

/**
 * Renders lyrics into `container`. Each line shows the original and, below it in smaller type,
 * the translation into the site language. Returns an update(time) function for synced lyrics.
 * opts.select: { max, onChange(selected) } turns tapping into choosing lines (for story cards).
 */
export function lyricsView(container, data, { big = false, song = null, select = null } = {}) {
  container.innerHTML = "";
  if (!data) { container.append(h("div", { class: "muted" }, t("np.noLyrics"))); return () => {}; }
  const tr = translationFor(song, data);
  container.classList.toggle("show-tr", !!tr && trEnabled());
  const synced = !!data.synced;
  const lines = synced
    ? data.synced.map(([at, text], i) => ({ at, text: text || "", tr: tr?.[i] }))
    : (data.plain || "").split("\n").map((text, i) => ({ at: 0, text, tr: tr?.[i] }));
  const picked = new Set();
  const els = lines.map((l, i) => {
    const el = h("div", { class: `lyric${synced ? "" : " plain-line"}` },
      h("div", { class: "lx" }, l.text || (synced ? "♪" : "\u00a0")),
      l.tr ? h("div", { class: "lt" }, l.tr) : null);
    el.addEventListener("click", () => {
      if (select) {
        if (!l.text) return;
        if (picked.has(i)) picked.delete(i);
        else if (picked.size >= (select.max || 4)) { toast(t("lyrics.max")); return; }
        else picked.add(i);
        el.classList.toggle("picked", picked.has(i));
        haptic("select");
        select.onChange([...picked].sort((a, b) => a - b).map((k) => lines[k]));
      } else if (synced && player.current?.id === song?.id) { seek(l.at); haptic("select"); }
    });
    return el;
  });
  container.append(...els);
  container.classList.toggle("selecting", !!select);
  if (!synced || select) return () => {};
  let current = -1, userScrollUntil = 0;
  const pauseAuto = () => { userScrollUntil = Date.now() + 3500; };
  container.addEventListener("wheel", pauseAuto, { passive: true });
  container.addEventListener("touchmove", pauseAuto, { passive: true });
  const update = (time) => {
    if (player.current?.id !== song?.id) return;
    let lo = 0, hi = lines.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].at <= time + 0.25) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    if (idx === current) return;
    current = idx;
    els.forEach((el, i) => { el.classList.toggle("active", i === idx); el.classList.toggle("past", i < idx); });
    if (idx >= 0 && Date.now() > userScrollUntil) {
      const el = els[idx];
      container.scrollTo({ top: el.offsetTop - container.clientHeight * (big ? 0.35 : 0.3), behavior: "smooth" });
    }
  };
  update(currentTime());
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

/** Redraw (e.g. after the language changed). */
export function refreshNowPlaying() { if (isOpen) render(); }

function render() {
  const s = player.current;
  const el = root();
  el.innerHTML = "";
  if (!s) return;
  const color = s.color || "#535353";
  const playBtn = h("button", { class: "np-play", "aria-label": t("common.play"), html: icon(isPlaying() ? "pause" : "play"), onclick: () => { haptic("medium"); toggle(); } });
  const range = h("input", { class: "range", type: "range", min: 0, max: 1000, value: 0, "aria-label": "Time" });
  const tCur = h("span", null, "0:00"), tDur = h("span", null, fmtTime(s.duration));
  range.addEventListener("input", () => {
    seeking = true;
    tCur.textContent = fmtTime((range.value / 1000) * (duration() || s.duration));
    range.style.setProperty("--p", `${range.value / 10}%`);
  });
  range.addEventListener("change", () => { seek((range.value / 1000) * (duration() || s.duration)); seeking = false; });

  const shuffleBtn = h("button", { class: `icon-btn${player.shuffle ? " on" : " muted"}`, "aria-label": t("common.shuffle"), html: icon("shuffle"), onclick: () => { haptic("select"); setShuffle(!player.shuffle); } });
  const repeatBtn = h("button", { class: `icon-btn${player.repeat !== "off" ? " on" : " muted"}`, "aria-label": t("common.repeat"), html: icon(player.repeat === "one" ? "repeat1" : "repeat"), onclick: () => { haptic("select"); cycleRepeat(); } });

  const lyricsBox = h("div", { class: "np-lyrics" }, h("div", { class: "spinner" }));
  const trBtn = h("button", { class: "chip-btn", hidden: true }, `🌐 ${t("lyrics.translate")}`);
  const lyricsCard = s.lyrics ? h("div", { class: "np-card", style: { background: rgba(color, 0.9) } },
    h("h4", null, t("common.lyrics"), h("span", { class: "card-tools" },
      trBtn,
      h("button", { class: "chip-btn", "aria-label": t("lyrics.share"), html: icon("share", 16), onclick: () => openFullLyrics(s, true) }),
      h("button", { class: "link-btn", onclick: () => openFullLyrics(s) }, t("np.expand")))),
    lyricsBox) : null;
  if (s.lyrics) {
    getLyrics(s).then((data) => {
      if (player.current?.id !== s.id) return;
      lyricsUpdate = lyricsView(lyricsBox, data, { song: s });
      if (translationFor(s, data)) {
        trBtn.hidden = false;
        trBtn.classList.toggle("on", trEnabled());
        trBtn.onclick = () => { setTrEnabled(!trEnabled()); trBtn.classList.toggle("on", trEnabled()); lyricsBox.classList.toggle("show-tr", trEnabled()); };
      }
    });
  } else lyricsUpdate = () => {};

  const pills = [
    link(`genre/${encodeURIComponent(s.genre)}`, { class: "pill" }, genre(s.genre).emoji, " ", genre(s.genre).label),
    ...(s.moods || []).map((m) => link(`mood/${m}`, { class: "pill" }, mood(m).emoji, " ", mood(m).label)),
    h("span", { class: "pill" }, "🌐 ", lang(s.language)),
    s.bpm ? h("span", { class: "pill" }, `${s.bpm} BPM`) : null,
    s.year ? h("span", { class: "pill" }, `📅 ${s.year}`) : null,
  ];
  const desc = describe(s);
  const about = h("div", { class: "np-card" },
    h("h4", null, t("np.about"), link(`song/${s.id}`, { class: "link-btn" }, t("np.details"))),
    h("div", { class: "np-about" },
      desc ? h("div", null, desc) : null,
      s.album ? h("div", { class: "muted" }, `💿 ${s.album}${s.year ? ` · ${s.year}` : ""}`) : null,
      h("div", { class: "pills" }, pills)));

  const queueCard = h("div", { class: "np-card np-queue" });
  const renderQueue = () => {
    const { upNext, rest } = upcoming(5);
    queueCard.innerHTML = "";
    queueCard.append(h("h4", null, t("np.queue"), h("button", { class: "link-btn", onclick: openQueue }, t("common.all"))));
    const items = [...upNext, ...rest].slice(0, 5);
    if (!items.length) queueCard.append(h("div", { class: "muted" }, t("np.queueEmpty")));
    items.forEach((q, n) => {
      queueCard.append(songRow(q, { showPlays: false, onClick: () => {
        if (n < upNext.length) { removeUpNext(n); player.queue.splice(player.index + 1, 0, q.id); jumpTo(player.index + 1); }
        else { const i = player.queue.indexOf(q.id, player.index + 1); if (i >= 0) jumpTo(i); }
      } }));
    });
  };
  renderQueue();

  const added = Date.parse(s.addedAt || 0);
  const artBox = h("div", { class: `np-art${isPlaying() ? "" : " paused"}` }, art(s));
  el.append(
    h("div", { class: "np-bg", style: { background: `linear-gradient(180deg, ${rgba(color, 0.95)} 0%, ${rgba(color, 0.55)} 40%, #121212 85%)` } }),
    h("div", { class: "np-inner" },
      h("div", { class: "np-head" },
        h("button", { class: "icon-btn", "aria-label": t("common.close"), html: icon("down", 28), onclick: popOverlay }),
        h("div", { class: "ctx" }, h("small", null, contextKicker()), h("b", null, player.context.title || s.album || "")),
        h("button", { class: "icon-btn", "aria-label": t("common.more"), html: icon("more"), onclick: () => songMenu(s) })),
      artBox,
      h("div", { class: "np-title-row" },
        h("div", { class: "txt" },
          h("div", { class: "np-title" }, s.title),
          h("div", { class: "np-artist" }, s.artists.map((a, i) => [i ? ", " : "", link(`artist/${encodeURIComponent(a)}`, null, a), verifiedBadge(a, 14)]))),
        heartButton(s, 28)),
      h("div", { class: "np-seek" }, range, h("div", { class: "np-times" }, tCur, tDur)),
      h("div", { class: "np-controls" },
        shuffleBtn,
        h("button", { class: "icon-btn skip", "aria-label": t("common.prev"), html: icon("prev"), onclick: () => { haptic("light"); prev(); } }),
        playBtn,
        h("button", { class: "icon-btn skip", "aria-label": t("common.next"), html: icon("next"), onclick: () => { haptic("light"); next(); } }),
        repeatBtn),
      h("div", { class: "np-bottom" },
        h("button", { class: "icon-btn", "aria-label": t("common.lyrics"), html: icon("mic"), onclick: () => (s.lyrics ? openFullLyrics(s) : null), style: { opacity: s.lyrics ? 1 : 0.35 } }),
        h("button", { class: "icon-btn", "aria-label": t("common.share"), html: icon("share"), onclick: () => openShare(s, { at: currentTime(), onLyrics: () => openFullLyrics(s, true) }) }),
        h("button", { class: "icon-btn", "aria-label": t("common.queue"), html: icon("queue"), onclick: openQueue })),
      h("div", { class: "np-stats" },
        h("span", null, `▶ ${t("common.plays", { n: plays(s.id) })}`),
        added ? h("span", null, `➕ ${t("np.addedAgo", { when: timeAgo(added) })}`) : null),
      lyricsCard, about, queueCard));

  el._update = { playBtn, range, tCur, tDur, shuffleBtn, repeatBtn, renderQueue, art: el.querySelector(".np-art") };
  updateTime();
}

function contextKicker() {
  const map = { radio: "ctx.radio", mix: "ctx.mix", artist: "ctx.artist", genre: "ctx.genre", mood: "ctx.mood",
    liked: "ctx.liked", search: "ctx.search", autoplay: "ctx.autoplay", album: "ctx.album" };
  return t(map[player.context.type] || "np.playing");
}

function updateTime() {
  const u = root()._update;
  if (!u || seeking) return;
  const d = duration();
  const time = currentTime();
  const p = d ? (time / d) * 1000 : 0;
  u.range.value = p;
  u.range.style.setProperty("--p", `${p / 10}%`);
  u.tCur.textContent = fmtTime(time);
  u.tDur.textContent = fmtTime(d);
}

// ------------------------------------------------------------------ full-screen lyrics
/** Full-screen lyrics. select=true: pick up to 4 lines for a story card. */
export function openFullLyrics(s = player.current, select = false) {
  if (!s?.lyrics) return;
  const box = h("div", { class: "np-lyrics" }, h("div", { class: "spinner" }));
  let chosen = [];
  const count = h("span", null, t("lyrics.pick"));
  const go = h("button", { class: "btn accent", disabled: true, onclick: () => openStory(s, chosen) }, h("span", { html: icon("share", 18) }), t("share.title"));
  const bar = h("div", { class: "pick-bar", hidden: !select }, count, go);
  const trBtn = h("button", { class: "chip-btn", hidden: true }, `🌐 ${t("lyrics.translate")}`);
  const shareBtn = h("button", { class: "icon-btn", "aria-label": t("lyrics.share"), html: icon("share", 24) });
  const panel = h("div", { class: "lyrics-full", style: { background: rgba(s.color || "#535353", 1) } },
    h("div", { class: "np-head" },
      h("button", { class: "icon-btn", html: icon("down", 28), onclick: popOverlay }),
      h("div", { class: "ctx" }, h("b", null, s.title), h("small", { style: { textTransform: "none", letterSpacing: 0 } }, s.artist)),
      trBtn, shareBtn),
    box, bar);
  document.body.append(panel);
  let data = null;
  const draw = (selecting) => {
    bar.hidden = !selecting;
    chosen = [];
    count.textContent = selecting ? t("lyrics.pick") : "";
    go.disabled = true;
    const view = lyricsView(box, data, { big: true, song: s, select: selecting ? { max: 4, onChange: (sel) => {
      chosen = sel;
      count.textContent = sel.length ? t("lyrics.picked", { n: sel.length }) : t("lyrics.pick");
      go.disabled = !sel.length;
    } } : null });
    fullLyricsUpdate = selecting ? null : view;
  };
  shareBtn.onclick = () => draw(bar.hidden);
  getLyrics(s).then((d) => {
    data = d;
    draw(select);
    if (translationFor(s, d)) {
      trBtn.hidden = false;
      trBtn.classList.toggle("on", trEnabled());
      trBtn.onclick = () => { setTrEnabled(!trEnabled()); trBtn.classList.toggle("on", trEnabled()); box.classList.toggle("show-tr", trEnabled()); };
    }
  });
  pushOverlay(() => { fullLyricsUpdate = null; panel.remove(); });
}

// ------------------------------------------------------------------ queue sheet
export function openQueue() {
  openSheet((sheet) => {
    const build = () => {
      sheet.querySelectorAll(".q").forEach((x) => x.remove());
      const box = h("div", { class: "q", style: { padding: "0 8px" } });
      const head = (text) => h("div", { class: "section-head", style: { padding: "14px 8px 4px" } }, h("h2", { style: { fontSize: "17px" } }, text));
      const cur = player.current;
      if (cur) box.append(head(t("queue.now")), songRow(cur, { showPlays: false, onClick: toggle }));
      const { upNext, rest } = upcoming(60);
      if (upNext.length) {
        box.append(head(t("queue.yours")));
        upNext.forEach((s, i) => box.append(songRow(s, { showPlays: false, onClick: () => {
          removeUpNext(i); player.queue.splice(player.index + 1, 0, s.id); jumpTo(player.index + 1);
        } })));
      }
      box.append(head(t("queue.next", { t: player.context.title || t("common.queue") })));
      if (!rest.length) box.append(h("div", { class: "muted", style: { padding: "8px" } }, t("queue.autoplay")));
      rest.forEach((s, i) => box.append(songRow(s, { showPlays: false, onClick: () => jumpTo(player.index + 1 + i) })));
      sheet.append(box);
    };
    build();
    const off = on("queue", () => { if (sheet.isConnected) build(); else off(); });
  });
}

// ------------------------------------------------------------------ events
on("track", () => { if (isOpen) render(); });
on("time", ({ t: time }) => {
  if (isOpen) { updateTime(); lyricsUpdate(time); }
  if (fullLyricsUpdate) fullLyricsUpdate(time);
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
on("library", () => { if (isOpen) render(); });

export { coverUrl, lib };
