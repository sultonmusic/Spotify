// App shell: boot, router, player bar, sidebar, keyboard shortcuts, live refresh.
import { CONFIG } from "./config.js";
import { loadLibrary, on, initSync, favSongs, songsOf, toggleFav } from "./store.js";
import { player, restore, toggle, next, prev, seek, setVolume, isPlaying, pruneMissing, setShuffle, cycleRepeat, currentTime, duration } from "./player.js";
import { h, icon, art, artistArt, likedArt, collage, fmtTime, refreshMarks, toast, go, link, overlayOpen, popOverlay, heartButton, nav, back, verifiedBadge, setShareImpl, setOpenPlayerImpl } from "./ui.js";
import { t, LANG } from "./i18n.js";
import * as V from "./views.js";
import { openNowPlaying, openQueue, openFullLyrics, refreshNowPlaying } from "./nowplaying.js";
import { openShare } from "./share.js";
import { initTelegram, setBackButton, startParam, haptic, inTelegram } from "./tg.js";
import { artistsRanked } from "./reco.js";

const main = document.getElementById("main");
const viewRoot = document.getElementById("view");

// ------------------------------------------------------------------ router
const ROUTES = [
  [/^\/?(home)?$/, () => V.viewHome(), "home"],
  [/^\/search(?:\/(.*))?$/, (q) => V.viewSearch(q), "search"],
  [/^\/library(?:\/(\w+))?$/, (t) => V.viewLibrary(t || "favs"), "library"],
  [/^\/liked$/, () => V.viewLiked(), "library"],
  [/^\/artist\/(.+)$/, (a) => V.viewArtist(a)],
  [/^\/genre\/(.+)$/, (g) => V.viewGenre(g)],
  [/^\/mood\/(.+)$/, (m) => V.viewMood(m)],
  [/^\/lang\/(.+)$/, (l) => V.viewLang(l)],
  [/^\/mix\/(.+)$/, (id) => V.viewMix(id)],
  [/^\/song\/([^/]+)(?:\/(\d+))?$/, (id, at) => V.viewSong(id, Number(at) || 0)],
  [/^\/add$/, () => V.viewAdd()],
];
const ROOT_TABS = new Set(["home", "search", "library"]);
const scrollMemo = new Map();
const visited = [];
let currentPath = null;
let currentTab = "home";

function parsePath() {
  const raw = location.hash.replace(/^#/, "") || "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function render(path, { keepScroll = false } = {}) {
  let node = null, tab = null;
  for (const [re, fn, t] of ROUTES) {
    const m = re.exec(path);
    if (m) {
      node = fn(...m.slice(1).map((x) => (x !== undefined ? decodeURIComponent(x) : undefined)));
      tab = t || null;
      break;
    }
  }
  if (!node) node = V.viewNotFound();
  const top = main.scrollTop;
  viewRoot.replaceChildren(node);
  currentTab = tab;
  document.querySelectorAll("[data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  document.querySelectorAll(".tabbar [data-tab]").forEach((a) => {
    a.querySelector(".ico").innerHTML = icon(a.dataset.tab === "home" && tab === "home" ? "homeFill" : a.dataset.icon, 24);
  });
  if (keepScroll) main.scrollTop = top;
  updateTopbar();
  updateBack();
}

// Search queries and library tabs replace the history entry, so they count as one page.
const pageKey = (p) => (p.startsWith("/search") ? "/search" : p.startsWith("/library") ? "/library" : p);

function route() {
  const path = parsePath();
  if (currentPath !== null) scrollMemo.set(currentPath, main.scrollTop);
  const key = pageKey(path);
  const isBack = visited.length > 1 && visited[visited.length - 2] === key;
  if (isBack) visited.pop();
  else if (visited[visited.length - 1] !== key) visited.push(key);
  if (visited.length > 60) visited.splice(0, visited.length - 60);
  nav.depth = visited.length;
  currentPath = path;
  render(path);
  main.scrollTop = isBack ? (scrollMemo.get(path) || 0) : 0;
}

function updateBack() {
  setBackButton(overlayOpen() || !ROOT_TABS.has(currentTab || ""), back);
}

function updateTopbar() {
  const bar = viewRoot.querySelector(".topbar");
  if (!bar) return;
  const hero = viewRoot.querySelector(".hero");
  const color = hero?.querySelector(".hero-bg") ? getComputedStyle(hero.querySelector(".hero-bg")).backgroundImage : "";
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (m) bar.style.setProperty("--topbar-bg", `rgba(${m[1].split(",").slice(0, 3).join(",")},0.97)`);
  bar.classList.toggle("solid", main.scrollTop > (hero ? 180 : 20));
}
main.addEventListener("scroll", updateTopbar, { passive: true });

window.addEventListener("hashchange", route);
window.addEventListener("app:rerender", () => render(parsePath(), { keepScroll: true }));
window.addEventListener("app:lang", () => {
  buildTabbar();
  buildSidebar();
  V.invalidateMixes();
  render(parsePath(), { keepScroll: true });
  refreshNowPlaying();
});
on("overlay", updateBack);

// ------------------------------------------------------------------ player bar
function buildPlayerBar() {
  const bar = document.getElementById("playerbar");
  const cover = h("div", { class: "pb-cover-wrap" });
  const title = h("div", { class: "pb-title" });
  const artist = h("div", { class: "pb-artist" });
  const heartSlot = h("span");
  const playBtn = h("button", { class: "icon-btn", "aria-label": t("common.play"), onclick: (e) => { e.stopPropagation(); haptic("light"); toggle(); } });
  const progress = h("i");
  const range = h("input", { class: "range", type: "range", min: 0, max: 1000, value: 0, "aria-label": "Time" });
  const tCur = h("span", null, "0:00"), tDur = h("span", null, "0:00");
  let seeking = false;
  range.addEventListener("input", () => { seeking = true; range.style.setProperty("--p", `${range.value / 10}%`); tCur.textContent = fmtTime((range.value / 1000) * duration()); });
  range.addEventListener("change", () => { seek((range.value / 1000) * duration()); seeking = false; });
  const vol = h("input", { class: "range", type: "range", min: 0, max: 100, value: Math.round(player.volume * 100), "aria-label": t("common.volume") });
  vol.style.setProperty("--p", `${vol.value}%`);
  vol.addEventListener("input", () => { setVolume(vol.value / 100); vol.style.setProperty("--p", `${vol.value}%`); });
  const shuffleBtn = h("button", { class: "icon-btn muted only-desktop", html: icon("shuffle", 18), "aria-label": t("common.shuffle"), onclick: () => setShuffle(!player.shuffle) });
  const repeatBtn = h("button", { class: "icon-btn muted only-desktop", html: icon("repeat", 18), "aria-label": t("common.repeat"), onclick: cycleRepeat });

  const info = h("div", { class: "pb-info", onclick: openNowPlaying }, title, artist);
  bar.append(
    h("div", { class: "pb-left" }, h("div", { onclick: openNowPlaying, style: { cursor: "pointer" } }, cover), info, heartSlot),
    h("div", { class: "pb-center" },
      h("div", { class: "pb-controls" },
        shuffleBtn,
        h("button", { class: "icon-btn only-desktop", html: icon("prev", 20), "aria-label": t("common.prev"), onclick: prev }),
        playBtn,
        h("button", { class: "icon-btn only-desktop", html: icon("next", 20), "aria-label": t("common.next"), onclick: () => next() }),
        repeatBtn),
      h("div", { class: "pb-seek" }, tCur, range, tDur)),
    h("div", { class: "pb-extra" },
      h("button", { class: "icon-btn muted", html: icon("mic", 18), "aria-label": t("common.lyrics"), onclick: openNowPlaying }),
      h("button", { class: "icon-btn muted", html: icon("queue", 18), "aria-label": t("common.queue"), onclick: openQueue }),
      h("span", { class: "muted", html: icon("volume", 18), style: { display: "flex" } }), vol,
      h("button", { class: "icon-btn muted", html: icon("down", 18), style: { transform: "rotate(180deg)" }, "aria-label": t("np.expand"), onclick: openNowPlaying })),
    h("div", { class: "pb-progress" }, progress));

  const setTrack = (s) => {
    bar.hidden = !s;
    document.body.classList.toggle("has-player", !!s);
    if (!s) return;
    cover.replaceChildren(art(s, "pb-cover"));
    title.textContent = s.title;
    artist.textContent = s.artist;
    heartSlot.replaceChildren(heartButton(s, 22));
    bar.style.setProperty("--pb-bg", s.color || "#333");
    tDur.textContent = fmtTime(s.duration);
    document.title = `${s.title} • ${s.artist}`;
  };
  const setPlaying = () => { playBtn.innerHTML = icon(isPlaying() ? "pause" : "play", 24); };
  const setModes = () => {
    shuffleBtn.className = `icon-btn only-desktop${player.shuffle ? " on" : " muted"}`;
    repeatBtn.className = `icon-btn only-desktop${player.repeat !== "off" ? " on" : " muted"}`;
    repeatBtn.innerHTML = icon(player.repeat === "one" ? "repeat1" : "repeat", 18);
  };
  on("track", (s) => { setTrack(s); setPlaying(); refreshMarks(); });
  on("state", () => { setPlaying(); refreshMarks(); syncFabs(); });
  on("modes", setModes);
  on("time", ({ t: time, d }) => {
    const p = d ? (time / d) * 100 : 0;
    progress.style.width = `${p}%`;
    if (!seeking) { range.value = p * 10; range.style.setProperty("--p", `${p}%`); tCur.textContent = fmtTime(time); tDur.textContent = fmtTime(d); }
  });
  on("error", ({ song }) => toast(t("toast.failed", { t: song?.title || "" })));
  setTrack(player.current);
  setPlaying();
  setModes();
}

/** Keep big play buttons in sync with the player state. */
function syncFabs() {
  document.querySelectorAll("[data-ctx]").forEach((b) => {
    const [type, ...rest] = b.dataset.ctx.split(":");
    const mine = player.context.type === type && player.context.id === rest.join(":");
    b.innerHTML = icon(mine && isPlaying() ? "pause" : "play", 26);
  });
  document.querySelectorAll("[data-songfab]").forEach((b) => {
    b.innerHTML = icon(player.current?.id === b.dataset.songfab && isPlaying() ? "pause" : "play", 26);
  });
}
on("track", syncFabs);

// ------------------------------------------------------------------ sidebar (desktop)
let sidebarBuilt = false;
function buildSidebar() {
  const side = document.getElementById("sidebar");
  side.replaceChildren();
  const libBox = h("div", { class: "side-box grow" });
  const addLink = h("a", { href: "#/add", hidden: true, html: `${icon("plus")}<span>${t("add.title")}</span>` });
  V.ownerMode().then((ok) => { addLink.hidden = !ok; });
  side.append(
    h("div", { class: "side-box" },
      h("div", { class: "brand" }, h("img", { src: "icons/icon-192.png", alt: "" }), CONFIG.appName),
      h("nav", { class: "side-nav" },
        h("a", { href: "#/", dataset: { tab: "home" }, html: `${icon("home")}<span>${t("nav.home")}</span>` }),
        h("a", { href: "#/search", dataset: { tab: "search" }, html: `${icon("search")}<span>${t("nav.search")}</span>` }),
        h("a", { href: "#", onclick: (e) => { e.preventDefault(); V.openSettings(); }, html: `<span style="width:24px;text-align:center">🌐</span><span>${t("settings.language")}: ${LANG.toUpperCase()}</span>` }),
        addLink)),
    libBox);
  const fill = () => {
    libBox.replaceChildren(
      h("a", { class: "side-title", href: "#/library", dataset: { tab: "library" }, html: `${icon("library")}<span>${t("nav.yourLibrary")}</span>` }),
      link("liked", { class: "side-item" }, likedArt(), h("div", { style: { minWidth: 0 } }, h("div", { class: "t" }, t("home.liked")), h("div", { class: "s" }, `${t("common.playlist")} • ${t("common.songs", { n: favSongs().length })}`))),
      ...V.mixes().slice(0, 4).map((m, i) => link(`mix/${m.id}`, { class: "side-item" }, collage(m.songs),
        h("div", { style: { minWidth: 0 } }, h("div", { class: "t" }, t("home.dailyMix", { n: i + 1 })), h("div", { class: "s" }, t("common.mix"))))),
      ...artistsRanked(12).map((a) => link(`artist/${encodeURIComponent(a)}`, { class: "side-item round" }, artistArt(a),
        h("div", { style: { minWidth: 0 } }, h("div", { class: "t" }, a, verifiedBadge(a, 13)), h("div", { class: "s" }, `${t("common.artist")} • ${songsOf(a).length}`)))));
    document.querySelectorAll("[data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === currentTab));
  };
  fill();
  sidebarFill = fill;
  if (sidebarBuilt) return;
  sidebarBuilt = true;
  on("library", () => sidebarFill());
  on("favs", () => sidebarFill());
}
let sidebarFill = () => {};

function buildTabbar() {
  const bar = document.getElementById("tabbar");
  bar.replaceChildren();
  for (const [tab, ico, label, href] of [["home", "home", t("nav.home"), "#/"], ["search", "search", t("nav.search"), "#/search"], ["library", "library", t("nav.library"), "#/library"]]) {
    bar.append(h("a", { href, dataset: { tab, icon: ico }, onclick: (e) => {
      const here = parsePath();
      if (tab === "search" && currentTab === "search") {
        // Pressing Search again: start typing (focus opens the keyboard)
        e.preventDefault();
        const input = document.querySelector(".search-input input");
        if (input) { main.scrollTo({ top: 0 }); input.focus(); input.select(); }
        return;
      }
      const atRoot = tab === "home" ? /^\/?(home)?$/.test(here) : here === href.slice(1);
      if (atRoot) { e.preventDefault(); main.scrollTo({ top: 0, behavior: "smooth" }); }
    } }, h("span", { class: "ico", html: icon(ico, 24) }), label));
  }
}

setOpenPlayerImpl(openNowPlaying);
setShareImpl((s) => openShare(s, {
  at: player.current?.id === s.id ? currentTime() : 0,
  onLyrics: () => openFullLyrics(s, true),
}));

// ------------------------------------------------------------------ no copying, no long-press menus
const inField = (el) => !!(el && (el.nodeType === 1 ? el : el.parentElement)?.closest?.("input, textarea"));
for (const ev of ["contextmenu", "copy", "cut", "selectstart", "dragstart"]) {
  document.addEventListener(ev, (e) => { if (!inField(e.target)) e.preventDefault(); }, { capture: true });
}

// ------------------------------------------------------------------ keyboard (desktop)
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input[type=search], input[type=text], textarea")) return;
  if (e.code === "Space") { e.preventDefault(); toggle(); }
  else if (e.code === "ArrowRight" && e.shiftKey) next();
  else if (e.code === "ArrowLeft" && e.shiftKey) prev();
  else if (e.code === "ArrowRight") seek(currentTime() + 5);
  else if (e.code === "ArrowLeft") seek(currentTime() - 5);
  else if (e.key === "l" && player.current) { const f = toggleFav(player.current.id); toast(f ? t("toast.faved") : t("toast.unfaved")); }
  else if (e.key === "/") { e.preventDefault(); go("search"); }
  else if (e.key === "Escape" && overlayOpen()) popOverlay();
});

// ------------------------------------------------------------------ live updates
on("favs", () => { refreshMarks(); if (/^\/(library(\/favs)?|liked)$/.test(currentPath || "")) render(currentPath, { keepScroll: true }); });
on("user", () => { V.invalidateMixes(); if (ROOT_TABS.has(currentTab || "")) render(currentPath, { keepScroll: true }); });

async function refresh() {
  try {
    const added = await loadLibrary();
    if (!added.length) return;
    V.invalidateMixes();
    pruneMissing();
    toast(added.length === 1 ? t("toast.newSong", { s: `${added[0].artist} — ${added[0].title}` }) : t("toast.newSongs", { n: added.length }), 3500);
    if (ROOT_TABS.has(currentTab || "") && currentTab !== "search") render(currentPath, { keepScroll: true });
  } catch { /* offline */ }
}

// ------------------------------------------------------------------ boot
async function boot() {
  initTelegram();
  document.documentElement.classList.toggle("in-telegram", inTelegram);
  buildTabbar();
  viewRoot.replaceChildren(h("div", { class: "spinner", style: { marginTop: "40vh" } }));
  try {
    await loadLibrary();
  } catch (e) {
    viewRoot.replaceChildren(h("div", { class: "empty" }, h("h3", null, t("load.error")),
      h("p", null, String(e.message || e)), h("button", { class: "btn", onclick: () => location.reload() }, t("common.retry"))));
    return;
  }
  buildSidebar();
  restore();
  buildPlayerBar();
  initSync();

  const sp = startParam();
  const m = /^song_([0-9a-f]{6,})$/.exec(sp);
  if (m && !location.hash.includes("/song/")) location.replace(`#/song/${m[1]}`);
  route();

  setInterval(refresh, CONFIG.refreshEvery);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot();
