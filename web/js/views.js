// Page views. Each returns a DOM node for #view.
import { CONFIG } from "./config.js";
import {
  lib, song as getSong, songsOf, artistNames, favSongs, setFavOrder, recentlyPlayed, plays, user, totalPlays, artistColor, loadLibrary,
} from "./store.js";
import * as reco from "./reco.js";
import { player, playList, playRadio, playSong, isPlaying, setShuffle, toggle } from "./player.js";
import {
  h, icon, art, artistArt, collage, likedArt, songRow, card, section, lazyList, heartButton, go, link, toast,
  fmtTime, fmtLong, timeAgo, num, shareSong, downloadSong, songMenu, placeholder, back as goBack, verifiedBadge,
  openSheet, sheetItem, openArtistInfo, openPlayer, isCurrent,
} from "./ui.js";
import { searchSongs, searchArtists, matchCategories } from "./search.js";
import * as dj from "./dj.js";
import { appBanner, appOffer, getApp } from "./install.js";
import { MOODS, genre, mood, lang, t, describe, LANG, LANGS_UI, setLang } from "./i18n.js";
import { canDownload, inTelegram, tg, isAdmin, haptic } from "./tg.js";
import { authEnabled, currentUser, signIn, signUp, signOut, signInGoogle, resetPassword, googleAllowed, errorKey } from "./auth.js";
import { rgba, getLyrics } from "./nowplaying.js";

// ------------------------------------------------------------------ shared bits
/** Asks the router to redraw the current page (keeps the scroll position). */
export function rerender() { window.dispatchEvent(new Event("app:rerender")); }

let mixCache = null;
export function mixes() {
  if (!mixCache || Date.now() - mixCache.at > 30 * 60_000 || mixCache.v !== lib.updatedAt) {
    mixCache = { at: Date.now(), v: lib.updatedAt, list: reco.dailyMixes(6) };
  }
  return mixCache.list;
}
export function invalidateMixes() { mixCache = null; }

const mixTitle = (m, i) => t("home.dailyMix", { n: i + 1 });
function mixSub(songs) {
  const names = [];
  for (const s of songs) for (const a of s.artists) if (!names.includes(a)) names.push(a);
  return names.slice(0, 3).join(", ") + (names.length > 3 ? ` ${t("common.and")}` : "");
}

function greeting() {
  const hr = new Date().getHours();
  if (hr >= 5 && hr < 11) return t("greet.morning");
  if (hr >= 11 && hr < 17) return t("greet.day");
  if (hr >= 17 && hr < 22) return t("greet.evening");
  return t("greet.night");
}

/** Settings: site language (Russian / English / Uzbek). */
export function openSettings() {
  openSheet((sheet, dismiss) => {
    sheet.append(h("div", { class: "sheet-head" }, h("div", null, h("b", null, t("settings.title")), h("span", null, t("settings.language")))));
    for (const [code, label] of Object.entries(LANGS_UI)) {
      sheet.append(sheetItem(code === LANG ? "check" : "globe", label, () => { dismiss(); if (code !== LANG) setTimeout(() => setLang(code), 250); },
        code === LANG ? "accent" : ""));
    }
    if (authEnabled) sheet.append(sheetItem("user", currentUser ? (currentUser.email || t("auth.account")) : t("auth.signIn"),
      () => { dismiss(); setTimeout(openAccount, 250); }, currentUser ? "accent" : ""));
    const app = appOffer();
    if (app) sheet.append(sheetItem("download", t(app === "apk" ? "settings.getApp" : "settings.installApp"), () => { dismiss(); getApp(); }));
    sheet.append(h("p", { class: "muted", style: { padding: "8px 20px 4px", fontSize: "12px", margin: 0 } }, `🔒 ${t("settings.about")}`));
  });
}

/** Sign in / sign up / account sheet (Firebase Auth). */
export function openAccount() {
  openSheet((sheet, dismiss) => {
    sheet.append(h("div", { class: "sheet-head" }, h("div", null, h("b", null, t("auth.account")), h("span", null, currentUser?.email || ""))));
    if (currentUser) {
      sheet.append(sheetItem("check", t("auth.signOut"), async () => { dismiss(); try { await signOut(); toast(t("auth.signedOut")); } catch { toast(t("auth.err.other")); } }));
      return;
    }
    let signup = false;
    const email = h("input", { class: "auth-input", type: "email", autocomplete: "email", placeholder: t("auth.email"), "aria-label": t("auth.email") });
    const pass = h("input", { class: "auth-input", type: "password", autocomplete: "current-password", placeholder: t("auth.password"), "aria-label": t("auth.password") });
    const err = h("p", { class: "auth-err", role: "alert" });
    const submit = h("button", { class: "btn accent auth-submit", type: "submit" });
    const toggleBtn = h("button", { class: "auth-link", type: "button" });
    const forgot = h("button", { class: "auth-link", type: "button" }, t("auth.forgot"));
    const paint = () => {
      submit.textContent = signup ? t("auth.signUp") : t("auth.signIn");
      toggleBtn.textContent = signup ? t("auth.haveAccount") : t("auth.noAccount");
      pass.autocomplete = signup ? "new-password" : "current-password";
      forgot.hidden = signup;
      err.textContent = "";
    };
    const run = async (fn) => {
      err.textContent = "";
      submit.disabled = true;
      try { await fn(); dismiss(); toast(t("auth.signedIn")); }
      catch (e) { const k = errorKey(e); if (k) err.textContent = t(k); }
      submit.disabled = false;
    };
    toggleBtn.onclick = () => { signup = !signup; paint(); };
    forgot.onclick = async () => {
      if (!email.value.trim()) { err.textContent = t("auth.needEmail"); return; }
      try { await resetPassword(email.value.trim()); toast(t("auth.resetSent")); } catch (e) { const k = errorKey(e); if (k) err.textContent = t(k); }
    };
    const form = h("form", { class: "auth-form", novalidate: "", onsubmit: (e) => {
      e.preventDefault();
      run(() => (signup ? signUp : signIn)(email.value.trim(), pass.value));
    } }, email, pass, err, submit);
    sheet.append(form);
    if (googleAllowed) form.append(h("button", { class: "btn ghost auth-google", type: "button", onclick: () => run(signInGoogle) }, t("auth.google")));
    form.append(toggleBtn, forgot);
    paint();
  });
}

function avatar() {
  // The platform's logo, not the visitor's own name or photo.
  return h("button", { class: "avatar logo", "aria-label": t("settings.title"), onclick: openSettings },
    h("img", { src: "icons/icon-192.png", alt: CONFIG.appName || "", draggable: "false" }));
}

function langButton() {
  return h("button", { class: "lang-btn", "aria-label": t("settings.language"), onclick: openSettings }, `🌐 ${LANG.toUpperCase()}`);
}

// ------------------------------------------------------------------ owner tools
const OWNER_KEY = "ms.owner";
const ownerFlag = () => { try { return localStorage.getItem(OWNER_KEY) === "1"; } catch { return false; } };

/** Resolves true for the station owner: in Telegram by id, in a browser once the owner opened the Add page. */
export function ownerMode() {
  if (inTelegram) return isAdmin(lib.site?.admins || []);
  return Promise.resolve(ownerFlag());
}

function addButton() {
  const b = h("button", { class: "icon-btn add-btn", hidden: true, "aria-label": t("add.title"), html: icon("plus", 22), onclick: () => { haptic("light"); go("add"); } });
  ownerMode().then((ok) => { b.hidden = !ok; });
  return b;
}

function topbar(title, { back = false } = {}) {
  return h("div", { class: "topbar" },
    back ? h("button", { class: "back-btn", "aria-label": t("common.back"), html: icon("back", 20), onclick: goBack }) : avatar(),
    back ? h("div", { class: "ttl" }, title) : h("h1", null, title),
    back ? null : addButton(),
    back ? null : langButton());
}

function songCard(s, list, context) {
  return card({
    artEl: art(s), title: s.title, sub: s.artist, playing: player.current?.id === s.id,
    onClick: () => (isCurrent(s) ? openPlayer() : go(`song/${s.id}`)),
    onPlay: () => playSong(s, list, context),
  });
}

function artistCard(a, sub) {
  return card({
    artEl: artistArt(a), title: h("span", null, a, verifiedBadge(a, 14)), sub: sub ?? t("common.artist"), round: true,
    onClick: () => go(`artist/${encodeURIComponent(a)}`),
  });
}

const shelf = (items) => h("div", { class: "shelf" }, items);

function emptyLibrary() {
  return h("div", { class: "empty" },
    h("div", { class: "big-ico", html: icon("note", 64) }),
    h("h3", null, t("empty.lib.title")),
    h("p", null, t("empty.lib.desc")));
}

function collectionHero({ kicker, title, artEl, desc, meta, color = "#535353", round = false }) {
  return h("div", { class: `hero${round ? " round" : ""}` },
    h("div", { class: "hero-bg", style: { background: `linear-gradient(${rgba(color, 0.85)}, ${rgba(color, 0.25)} 70%, transparent)` } }),
    h("div", { class: "art" }, artEl),
    h("div", null,
      kicker ? h("div", { class: "kicker" }, kicker) : null,
      h("h1", null, title),
      desc ? h("div", { class: "desc" }, desc) : null,
      meta ? h("div", { class: "meta" }, meta) : null));
}

function collectionActions(songs, context, extra = []) {
  const playingThis = () => player.context.type === context.type && player.context.id === context.id;
  const fab = h("button", { class: "play-fab lg", "aria-label": t("common.play"), html: icon(playingThis() && isPlaying() ? "pause" : "play", 26) });
  fab.addEventListener("click", () => (playingThis() ? toggle() : playList(songs, 0, context)));
  fab.dataset.ctx = `${context.type}:${context.id}`;
  const shuffleBtn = h("button", { class: "icon-btn", "aria-label": t("common.shuffle"), html: icon("shuffle", 26),
    onclick: () => { setShuffle(true); playList(songs, Math.floor(Math.random() * songs.length), context); toast(t("toast.shuffle")); } });
  return h("div", { class: "actions" }, fab, shuffleBtn, ...extra, h("div", { class: "grow" }));
}

function trackList(songs, context, { numbered = false } = {}) {
  const box = h("div", { class: "tracks" });
  lazyList(box, songs, (s, i) => songRow(s, { list: songs, context, index: numbered ? i : null }));
  return box;
}

const durationOf = (songs) => songs.reduce((a, s) => a + (s.duration || 0), 0);
const metaLine = (songs, extra) => [extra, t("common.songs", { n: songs.length }), fmtLong(durationOf(songs))].filter(Boolean).join(" • ");

// ------------------------------------------------------------------ HOME
export function viewHome() {
  const v = h("div", { class: "view" });
  if (!lib.songs.length) {
    v.append(topbar(greeting()), emptyLibrary());
    return v;
  }
  const color = player.current?.color || reco.newest(1)[0]?.color || "#404040";
  v.append(h("div", { class: "home-bg", style: { background: `linear-gradient(${rgba(color, 0.6)}, transparent)` } }));
  v.append(topbar(greeting()), appBanner());

  const moodCounts = new Map();
  for (const s of lib.songs) for (const m of s.moods || []) moodCounts.set(m, (moodCounts.get(m) || 0) + 1);
  const moodsPresent = [...moodCounts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([m]) => m);
  if (moodsPresent.length) {
    v.append(h("div", { class: "chips", style: { marginBottom: "16px", position: "relative" } },
      moodsPresent.map((m) => link(`mood/${m}`, { class: "chip" }, `${mood(m).emoji} ${mood(m).label}`))));
  }

  const quick = h("div", { class: "quick", style: { position: "relative" } });
  if (favSongs().length) quick.append(link("liked", { class: "quick-item" }, likedArt(), h("span", null, t("home.liked"))));
  const mx = mixes();
  if (mx[0] && lib.songs.length >= 8) quick.append(link(`mix/${mx[0].id}`, { class: "quick-item" }, collage(mx[0].songs), h("span", null, mixTitle(mx[0], 0))));
  for (const s of reco.quickPicks(7 - quick.childElementCount)) {
    const item = h("div", { class: `quick-item${player.current?.id === s.id ? " playing" : ""}`, role: "button", dataset: { qid: s.id } }, art(s), h("span", null, s.title));
    item.addEventListener("click", () => (isCurrent(s) ? openPlayer() : playSong(s, null, { type: "radio", id: s.id, title: t("ctx.radioOf", { t: s.title }) })));
    quick.append(item);
  }
  quick.append(djTile()); // the 8th tile
  v.append(quick);

  const forYou = reco.forYou(20);
  v.append(section(t("home.forYou"), shelf(forYou.map((s) => songCard(s, forYou, { type: "mix", id: "foryou", title: t("home.forYou") }))),
    { sub: t("home.forYouSub"), more: "#/mix/foryou" }));

  if (mx.length) {
    v.append(section(t("home.dailyMixes"), shelf(mx.map((m, i) => card({
      artEl: h("div", { style: { position: "relative", width: "100%", height: "100%" } }, collage(m.songs),
        h("div", { class: "mix-band", style: { background: m.genre ? genre(m.genre).color : "#22c55e" } }),
        h("div", { class: "mix-label" }, mixTitle(m, i))),
      title: m.genre ? genre(m.genre).label : t("home.mixed"), sub: mixSub(m.songs),
      onClick: () => go(`mix/${m.id}`), onPlay: () => playList(m.songs, 0, { type: "mix", id: m.id, title: mixTitle(m, i) }),
    })))));
  }

  const fresh = reco.newest(20);
  v.append(section(t("home.new"), shelf(fresh.map((s) => songCard(s, fresh, { type: "mix", id: "new", title: t("home.new") }))), { more: "#/mix/new" }));

  const recent = recentlyPlayed(20);
  if (recent.length) v.append(section(t("home.recent"), shelf(recent.map((s) => songCard(s, recent, { type: "mix", id: "recent", title: t("home.recent") }))), { more: "#/mix/recent" }));

  const rep = reco.onRepeat(20);
  if (rep.length >= 3) v.append(section(t("home.repeat"), shelf(rep.map((s) => songCard(s, rep, { type: "mix", id: "repeat", title: t("home.repeat") }))), { sub: t("home.repeatSub"), more: "#/mix/repeat" }));

  const artists = reco.artistsRanked(16);
  if (artists.length) v.append(section(t("home.artists"), shelf(artists.map((a) => artistCard(a, t("common.songs", { n: songsOf(a).length }))))));

  const disc = reco.discover(20);
  if (disc.length && user.history.length) v.append(section(t("home.discover"), shelf(disc.map((s) => songCard(s, disc, { type: "mix", id: "discover", title: t("home.discover") }))), { sub: t("home.discoverSub"), more: "#/mix/discover" }));

  const forgot = reco.forgotten(20);
  if (forgot.length >= 3) v.append(section(t("home.forgotten"), shelf(forgot.map((s) => songCard(s, forgot, { type: "mix", id: "forgotten", title: t("home.forgotten") }))), { more: "#/mix/forgotten" }));

  const top = reco.topSongs(20);
  if (top.length >= 3) v.append(section(t("home.top"), shelf(top.map((s) => songCard(s, top, { type: "mix", id: "top", title: t("home.top") }))), { more: "#/mix/top" }));

  v.append(section(t("home.genres"), genreTiles()));
  v.append(h("div", { class: "foot" }, t("footer", { n: t("common.songs", { n: lib.songs.length }) })));
  return v;
}

function genreTiles() {
  const counts = new Map();
  for (const s of lib.songs) counts.set(s.genre, (counts.get(s.genre) || 0) + 1);
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return h("div", { class: "tiles" }, list.map(([g]) => tile(genre(g), `genre/${encodeURIComponent(g)}`, lib.songs.find((s) => s.genre === g && s.cover))));
}

function tile(info, path, coverSong) {
  return link(path, { class: "tile", style: { background: info.color } },
    info.label,
    coverSong ? h("div", { class: "tile-art" }, art(coverSong)) : h("div", { class: "emoji" }, info.emoji));
}

// ------------------------------------------------------------------ SEARCH
let lastQuery = "";
export function viewSearch(param) {
  const v = h("div", { class: "view" });
  const input = h("input", { type: "search", placeholder: t("search.placeholder"), value: param ?? lastQuery, enterkeyhint: "search", autocomplete: "off", "aria-label": t("search.title") });
  const clear = h("button", { class: "icon-btn", style: { width: "28px", height: "28px", color: "#121212" }, html: icon("close", 20), "aria-label": t("search.clear") });
  const results = h("div");
  v.append(h("div", { class: "search-box" }, h("h1", null, t("search.title")),
    h("div", { class: "search-input" }, h("span", { html: icon("search", 22) }), input, clear)), results);

  const render = () => {
    const q = input.value.trim();
    lastQuery = q;
    clear.style.visibility = q ? "visible" : "hidden";
    results.innerHTML = "";
    if (!q) { results.append(browse()); return; }
    const songs = searchSongs(lib.songs, q);
    const artists = searchArtists(artistNames(), q);
    const cats = matchCategories(q);
    if (!songs.length && !artists.length && !cats.length) {
      results.append(h("div", { class: "empty" }, h("h3", null, t("search.none", { q })), h("p", null, t("search.noneHint"))));
      return;
    }
    const ctx = { type: "search", id: q, title: t("search.ctx", { q }) };
    const topArtist = artists[0] && (songs.length === 0 || songs[0].artists.includes(artists[0]) || artists[0].toLowerCase().startsWith(q.toLowerCase()));
    if (topArtist) {
      const a = artists[0];
      const el = h("div", { class: "top-result round", role: "button", onclick: () => go(`artist/${encodeURIComponent(a)}`) },
        h("div", { class: "art" }, artistArt(a)), h("div", null, h("h3", null, a, verifiedBadge(a, 20)), h("div", { class: "muted" }, t("common.artist"))),
        h("button", { class: "play-fab", html: icon("play", 22), onclick: (e) => { e.stopPropagation(); playList(popularOf(a), 0, { type: "artist", id: a, title: a }); } }));
      results.append(section(t("search.top"), el));
    } else if (songs[0]) {
      const s = songs[0];
      const el = h("div", { class: "top-result", role: "button", onclick: () => (isCurrent(s) ? openPlayer() : go(`song/${s.id}`)) },
        h("div", { class: "art" }, art(s)), h("div", null, h("h3", null, s.title), h("div", { class: "muted" }, `${t("common.song")} • ${s.artist}`)),
        h("button", { class: "play-fab", html: icon("play", 22), onclick: (e) => { e.stopPropagation(); playSong(s, songs, ctx); } }));
      results.append(section(t("search.top"), el));
    }
    if (songs.length) {
      const box = h("div", { class: "tracks" });
      lazyList(box, songs, (s) => songRow(s, { list: songs, context: ctx }), 30);
      results.append(section(t("search.songs"), box));
    }
    if (artists.length) results.append(section(t("search.artists"), shelf(artists.slice(0, 20).map((a) => artistCard(a)))));
    if (cats.length) results.append(section(t("search.categories"), h("div", { class: "tiles" }, cats.map((c) => tile(c, `${c.type}/${encodeURIComponent(c.key)}`)))));
  };

  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      render();
      history.replaceState(history.state, "", `#/search${input.value.trim() ? "/" + encodeURIComponent(input.value.trim()) : ""}`);
    }, 120);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  clear.addEventListener("click", () => { input.value = ""; render(); input.focus(); history.replaceState(history.state, "", "#/search"); });
  render();
  if (!input.value && matchMedia("(min-width: 900px)").matches) setTimeout(() => input.focus(), 50);
  return v;
}

function browse() {
  const wrap = h("div");
  if (!lib.songs.length) { wrap.append(emptyLibrary()); return wrap; }
  const recent = recentlyPlayed(6);
  if (recent.length) {
    const box = h("div", { class: "tracks" });
    recent.forEach((s) => box.append(songRow(s, { list: recent, context: { type: "mix", id: "recent", title: t("home.recent") } })));
    wrap.append(section(t("home.recent"), box));
  }
  const moodList = [...new Set(lib.songs.flatMap((s) => s.moods || []))].filter((m) => MOODS[m]);
  if (moodList.length) wrap.append(section(t("search.moods"), h("div", { class: "tiles" }, moodList.map((m) => tile(mood(m), `mood/${m}`)))));
  wrap.append(section(t("home.genres"), genreTiles()));
  const langs = new Map();
  for (const s of lib.songs) langs.set(s.language, (langs.get(s.language) || 0) + 1);
  if (langs.size > 1) {
    wrap.append(section(t("search.langs"), h("div", { class: "chips", style: { flexWrap: "wrap" } },
      [...langs.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => link(`lang/${l}`, { class: "chip" }, `${lang(l)} · ${n}`)))));
  }
  return wrap;
}

// ------------------------------------------------------------------ LIBRARY
const SORTS = {
  added: (a, b) => Date.parse(b.addedAt || 0) - Date.parse(a.addedAt || 0),
  title: (a, b) => a.title.localeCompare(b.title, LANG),
  artist: (a, b) => a.artist.localeCompare(b.artist, LANG),
  plays: (a, b) => plays(b.id) - plays(a.id),
  recent: (a, b) => (user.last[b.id] || 0) - (user.last[a.id] || 0),
};
let sortKey = "added";

export function viewLibrary(tab = "favs") {
  const v = h("div", { class: "view" });
  v.append(topbar(t("nav.yourLibrary")));
  const tabs = [["favs", t("lib.favs")], ["songs", t("lib.songs")], ["artists", t("lib.artists")], ["stats", t("lib.stats")]];
  v.append(h("div", { class: "lib-tabs" }, h("div", { class: "chips" },
    tabs.map(([k, label]) => h("button", { class: `chip${k === tab ? " active" : ""}`, onclick: () => location.replace(`#/library/${k}`) }, label)))));

  if (tab === "favs") {
    const favs = favSongs();
    v.append(link("liked", { class: "liked-banner" }, h("div", { class: "ico", html: icon("heartFill", 28) }),
      h("div", null, h("b", null, t("home.liked")), h("span", null, t("common.songs", { n: favs.length })))));
    if (!favs.length) v.append(h("div", { class: "empty" }, h("div", { class: "big-ico", html: icon("heart", 64) }),
      h("h3", null, t("lib.noFavs")), h("p", null, t("lib.noFavsDesc"))));
    else {
      if (favs.length > 1) v.append(h("div", { class: "lib-toolbar" }, h("span", null, metaLine(favs)), reorderButton()));
      v.append(trackList(favs, { type: "liked", id: "liked", title: t("home.liked") }));
    }
  } else if (tab === "songs") {
    if (!lib.songs.length) { v.append(emptyLibrary()); return v; }
    const sorted = lib.songs.slice().sort(SORTS[sortKey]);
    const select = h("select", { "aria-label": t("lib.sort") }, Object.keys(SORTS).map((k) => h("option", { value: k, selected: k === sortKey }, t(`sort.${k}`))));
    select.addEventListener("change", () => { sortKey = select.value; rerender(); });
    v.append(h("div", { class: "lib-toolbar" }, h("span", null, metaLine(sorted)), h("label", { style: { display: "flex", alignItems: "center", gap: "4px" } }, h("span", { html: icon("sort", 16) }), select)));
    v.append(trackList(sorted, { type: "library", id: sortKey, title: t("lib.allSongs") }));
  } else if (tab === "artists") {
    const names = artistNames().sort((a, b) => (Number(!!lib.artists[b]?.verified) - Number(!!lib.artists[a]?.verified)) || a.localeCompare(b, LANG));
    const box = h("div", { class: "tracks" });
    lazyList(box, names, (a) => {
      const p = songsOf(a).reduce((x, s) => x + plays(s.id), 0);
      return link(`artist/${encodeURIComponent(a)}`, { class: "row round" },
        h("div", { class: "cov-wrap" }, artistArt(a, "cov")),
        h("div", { class: "meta" }, h("div", { class: "t" }, h("span", null, a), verifiedBadge(a, 15)),
          h("div", { class: "s" }, [t("common.artist"), t("common.songs", { n: songsOf(a).length }), p ? t("common.plays", { n: p }) : null].filter(Boolean).join(" • "))));
    });
    v.append(box);
  } else {
    v.append(statsView());
  }
  return v;
}

function statsView() {
  const wrap = h("div");
  const tp = totalPlays();
  wrap.append(h("div", { class: "stat-cards" },
    h("div", { class: "stat" }, h("b", null, num(tp)), h("span", null, t("stats.plays"))),
    h("div", { class: "stat" }, h("b", null, fmtLong(user.listen || 0)), h("span", null, t("stats.time"))),
    h("div", { class: "stat" }, h("b", null, num(lib.songs.length)), h("span", null, t("stats.songs"))),
    h("div", { class: "stat" }, h("b", null, num(Object.keys(user.favs).length)), h("span", null, t("stats.favs")))));
  wrap.append(h("p", { class: "pad muted", style: { fontSize: "12px", marginTop: "10px" } },
    `${t("stats.note", { n: CONFIG.playThreshold })} ${inTelegram ? t("stats.synced") : ""}`));

  const top = reco.topSongs(10);
  if (top.length) {
    const box = h("div", { class: "tracks" });
    top.forEach((s, i) => box.append(songRow(s, { list: top, index: i, context: { type: "mix", id: "top", title: t("home.top") }, sub: `${s.artist} • ${t("common.times", { n: plays(s.id) })}` })));
    wrap.append(section(t("stats.topSongs"), box, { more: "#/mix/top" }));
  }
  const ta = reco.topArtists(8);
  if (ta.length) {
    const max = ta[0][1];
    wrap.append(section(t("stats.topArtists"), h("div", { class: "bars" }, ta.map(([a, n]) => link(`artist/${encodeURIComponent(a)}`, { class: "bar-row" },
      h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a),
      h("div", { class: "track" }, h("i", { style: { width: `${(n / max) * 100}%` } })), h("span", { class: "v" }, num(n)))))));
  }
  const byGenre = new Map();
  for (const s of lib.songs) byGenre.set(s.genre, (byGenre.get(s.genre) || 0) + (plays(s.id) || (tp ? 0 : 1)));
  const gl = [...byGenre.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (gl.length) {
    const max = gl[0][1];
    wrap.append(section(tp ? t("stats.genresFav") : t("stats.genresLib"), h("div", { class: "bars" }, gl.map(([g, n]) => link(`genre/${encodeURIComponent(g)}`, { class: "bar-row" },
      h("span", null, `${genre(g).emoji} ${genre(g).label}`),
      h("div", { class: "track" }, h("i", { style: { width: `${(n / max) * 100}%`, background: genre(g).color } })), h("span", { class: "v" }, num(n)))))));
  }
  const hist = user.history.slice(0, 30).map((x) => ({ ...x, s: getSong(x.id) })).filter((x) => x.s);
  if (hist.length) {
    const box = h("div", { class: "tracks" });
    hist.forEach((x) => box.append(songRow(x.s, { sub: `${x.s.artist} • ${timeAgo(x.t)}`, showPlays: false })));
    wrap.append(section(t("stats.history"), box));
  }
  if (!tp) wrap.append(h("div", { class: "empty" }, h("div", { class: "big-ico", html: icon("chart", 64) }), h("h3", null, t("stats.empty")), h("p", null, t("stats.emptyDesc"))));
  return wrap;
}

// ------------------------------------------------------------------ COLLECTIONS
function collectionView({ kicker, title, songs, artEl, desc, color, context, round = false, extraMeta, extraActions = [] }) {
  const v = h("div", { class: "view" });
  v.append(topbar(title, { back: true }));
  const hero = collectionHero({ kicker, title, artEl, desc, color, round, meta: metaLine(songs, extraMeta) });
  hero.style.marginTop = "-58px";
  v.append(hero);
  if (!songs.length) {
    v.append(h("div", { class: "empty" }, h("h3", null, t("collection.empty"))));
    return v;
  }
  v.append(collectionActions(songs, context, extraActions));
  v.append(trackList(songs, context, { numbered: context.type !== "liked" }));
  return v;
}

export function viewLiked() {
  const songs = favSongs();
  return collectionView({ kicker: t("common.playlist"), title: t("home.liked"), songs, artEl: likedArt(), color: "#5038a0",
    context: { type: "liked", id: "liked", title: t("home.liked") }, extraActions: songs.length > 1 ? [reorderButton()] : [] });
}

// ------------------------------------------------------------------ Liked Songs: your own order
function reorderButton() {
  return h("button", { class: "reorder-btn", html: `${icon("sort", 18)}<span>${t("lib.reorder")}</span>`,
    onclick: (e) => editFavOrder(e.currentTarget.closest(".view").querySelector(".tracks")) });
}

/** Swaps the track list for a drag-to-reorder editor (drag rows by ≡) until Done / Cancel. */
function editFavOrder(list) {
  if (!list) return;
  haptic("light");
  const box = h("div", { class: "tracks reorder" });
  for (const s of favSongs()) {
    box.append(h("div", { class: "row", dataset: { id: s.id } },
      h("div", { class: "cov-wrap" }, art(s, "cov")),
      h("div", { class: "meta" }, h("div", { class: "t" }, h("span", null, s.title)), h("div", { class: "s" }, s.artist)),
      h("div", { class: "drag", html: icon("grip", 22) })));
  }
  const save = () => { setFavOrder([...box.children].map((r) => r.dataset.id)); haptic("success"); toast(t("toast.orderSaved")); };
  const bar = h("div", { class: "reorder-bar" },
    h("span", null, t("lib.reorderHint")),
    h("button", { class: "btn ghost", onclick: rerender }, t("common.cancel")),
    h("button", { class: "btn accent", onclick: save }, t("common.done")));
  list.closest(".view")?.querySelectorAll(".reorder-btn").forEach((b) => { b.hidden = true; });
  list.replaceWith(h("div", { class: "reorder-wrap" }, bar, box));
  dragToReorder(box);
}

function dragToReorder(box) {
  const main = document.getElementById("main");
  let d = null;
  box.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag");
    if (!handle) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const row = handle.closest(".row");
    d = { row, y: e.clientY, h: row.getBoundingClientRect().height };
    row.classList.add("dragging");
    haptic("light");
  });
  box.addEventListener("pointermove", (e) => {
    if (!d) return;
    // near the top/bottom edge the page scrolls with the finger
    const r = main.getBoundingClientRect();
    const step = e.clientY < r.top + 80 ? -14 : e.clientY > r.bottom - 160 ? 14 : 0;
    if (step) { const before = main.scrollTop; main.scrollBy(0, step); d.y -= main.scrollTop - before; }
    let off = e.clientY - d.y;
    // the dragged row trades places with a neighbour once it passes that neighbour's middle
    while (off > d.h / 2 && d.row.nextElementSibling) {
      const n = d.row.nextElementSibling;
      box.insertBefore(n, d.row);
      d.y += n.getBoundingClientRect().height;
      off = e.clientY - d.y;
      haptic("select");
    }
    while (off < -d.h / 2 && d.row.previousElementSibling) {
      const p = d.row.previousElementSibling;
      box.insertBefore(d.row, p);
      d.y -= p.getBoundingClientRect().height;
      off = e.clientY - d.y;
      haptic("select");
    }
    d.row.style.transform = `translateY(${off}px)`;
  });
  const drop = () => {
    if (!d) return;
    d.row.style.transform = "";
    d.row.classList.remove("dragging");
    d = null;
  };
  box.addEventListener("pointerup", drop);
  box.addEventListener("pointercancel", drop);
}

export function viewMix(id) {
  const special = {
    foryou: ["home.forYou", () => reco.forYou(50)],
    new: ["home.new", () => reco.newest(100)],
    recent: ["home.recent", () => recentlyPlayed(100)],
    repeat: ["home.repeat", () => reco.onRepeat(50)],
    discover: ["home.discover", () => reco.discover(50)],
    forgotten: ["home.forgotten", () => reco.forgotten(50)],
    top: ["home.top", () => reco.topSongs(100)],
  };
  if (special[id]) {
    const [key, fn] = special[id];
    const songs = fn();
    return collectionView({ kicker: t("common.mix"), title: t(key), desc: t(`mix.${id}.desc`), songs, artEl: collage(songs),
      color: songs[0]?.color, context: { type: "mix", id, title: t(key) } });
  }
  const list = mixes();
  const idx = list.findIndex((m) => m.id === id);
  if (idx < 0) return viewNotFound(t("mix.notFound"));
  const m = list[idx];
  return collectionView({
    kicker: t("common.mix"), title: mixTitle(m, idx), songs: m.songs,
    desc: `${m.genre ? genre(m.genre).label + " • " : ""}${mixSub(m.songs)}. ${t("mix.daily.desc")}`,
    artEl: collage(m.songs), color: m.genre ? genre(m.genre).color : m.songs[0]?.color,
    context: { type: "mix", id: m.id, title: mixTitle(m, idx) },
  });
}

export function viewGenre(g) {
  const info = genre(g);
  const p = reco.profile();
  const songs = lib.songs.filter((s) => s.genre === g).map((s) => ({ s, sc: reco.score(s, p, { explore: 0.05, context: false }) }))
    .sort((a, b) => b.sc - a.sc).map((x) => x.s);
  return collectionView({ kicker: t("common.genre"), title: info.label, songs, artEl: songs.length ? collage(songs) : placeholder(g), color: info.color,
    desc: t("genre.desc"), context: { type: "genre", id: g, title: info.label } });
}

export function viewMood(m) {
  const info = mood(m);
  const songs = reco.moodMix(m, 200);
  return collectionView({ kicker: t("common.mood"), title: `${info.emoji} ${info.label}`, songs, artEl: songs.length ? collage(songs) : placeholder(m),
    color: info.color, desc: t("mood.desc", { m: info.label }), context: { type: "mood", id: m, title: info.label } });
}

export function viewLang(l) {
  const p = reco.profile();
  const songs = lib.songs.filter((s) => s.language === l).map((s) => ({ s, sc: reco.score(s, p, { context: false }) })).sort((a, b) => b.sc - a.sc).map((x) => x.s);
  return collectionView({ kicker: t("common.language"), title: lang(l), songs, artEl: songs.length ? collage(songs) : placeholder(l), color: songs[0]?.color,
    context: { type: "lang", id: l, title: lang(l) } });
}

function popularOf(name) {
  return songsOf(name).slice().sort((a, b) => (plays(b.id) - plays(a.id)) || (Date.parse(b.addedAt || 0) - Date.parse(a.addedAt || 0)));
}

export function viewArtist(name) {
  const songs = popularOf(name);
  if (!songs.length) return viewNotFound(t("artist.notFound"));
  const profile = lib.artists[name] || {};
  const totalP = songs.reduce((a, s) => a + plays(s.id), 0);
  const context = { type: "artist", id: name, title: name };
  const v = h("div", { class: "view" });
  v.append(topbar(name, { back: true }));
  const kicker = profile.verified
    ? h("button", { class: "verified-kicker", onclick: () => openArtistInfo(name) }, verifiedBadge(name, 20), t("common.verified"))
    : t("common.artist");
  const meta = [
    t("common.songs", { n: songs.length }),
    totalP ? t("common.plays", { n: totalP }) : null,
    profile.fans ? `${t("common.fans", { n: profile.fans })} ${t("artist.onDeezer")}` : null,
  ].filter(Boolean).join(" • ");
  const hero = collectionHero({ kicker, title: name, artEl: artistArt(name), round: true, color: artistColor(name), meta });
  hero.style.marginTop = "-58px";
  v.append(hero);
  v.append(collectionActions(songs, context, [
    h("button", { class: "icon-btn", "aria-label": t("artist.radio"), html: icon("radio", 24), onclick: () => playRadio(songs[0], { type: "radio", id: name, title: t("ctx.radioOf", { t: name }) }) }),
  ]));
  v.append(section(t("artist.popular"), trackList(songs.slice(0, 10), context, { numbered: true })));
  if (songs.length > 10) {
    const rest = songs.slice().sort((a, b) => (b.year || 0) - (a.year || 0));
    v.append(section(t("artist.all"), trackList(rest, context)));
  }
  const albums = new Map();
  for (const s of songs) if (s.album && s.album !== s.title) { if (!albums.has(s.album)) albums.set(s.album, []); albums.get(s.album).push(s); }
  if (albums.size) {
    v.append(section(t("artist.albums"), shelf([...albums.entries()].map(([al, list]) => card({
      artEl: art(list[0]), title: al, sub: [list[0].year, t("common.songs", { n: list.length })].filter(Boolean).join(" • "),
      onClick: () => playList(list, 0, { type: "album", id: al, title: al }), onPlay: () => playList(list, 0, { type: "album", id: al, title: al }),
    })))));
  }
  const bio = profile.bio ? profile.bio[LANG] || profile.bio.en || profile.bio.ru || Object.values(profile.bio)[0] : "";
  if (bio) {
    // Spotify-style "About" card; opens the full info sheet
    v.append(section(t("vi.about"), h("div", { class: "about-card", role: "button", onclick: () => openArtistInfo(name) },
      h("div", { class: "about-bg" }, artistArt(name)),
      h("div", { class: "about-body" },
        profile.fans ? h("b", null, `${t("common.fans", { n: profile.fans })} ${t("artist.onDeezer")}`) : null,
        h("p", null, bio)))));
  }
  const links = [["deezer", "Deezer"], ["apple", "Apple Music"]].filter(([k]) => profile[k]);
  if (links.length) {
    v.append(section(t("artist.links"), h("div", { class: "chips", style: { flexWrap: "wrap" } },
      links.map(([k, label]) => h("a", { class: "chip", href: profile[k], target: "_blank", rel: "noopener" }, `↗ ${label}`)))));
  }
  const sim = reco.similarArtists(name, 12);
  if (sim.length) v.append(section(t("artist.similar"), shelf(sim.map((a) => artistCard(a)))));
  return v;
}

// ------------------------------------------------------------------ SONG
export function viewSong(id, at = 0) {
  const s = getSong(id);
  if (!s) return viewPending(id);
  const v = h("div", { class: "view" });
  v.append(topbar(s.title, { back: true }));
  const n = plays(s.id);
  const hero = collectionHero({
    kicker: t("common.song"), title: s.title, artEl: art(s), color: s.color,
    meta: [
      ...s.artists.map((a, i) => [i ? h("span", null, ", ") : null, link(`artist/${encodeURIComponent(a)}`, null, h("b", null, a)), verifiedBadge(a, 15)]),
      s.album ? h("span", null, `• ${s.album}`) : null, s.year ? h("span", null, `• ${s.year}`) : null,
      h("span", null, `• ${fmtTime(s.duration)}`), n ? h("span", null, `• ${t("common.plays", { n })}`) : null,
    ],
  });
  hero.style.marginTop = "-58px";
  v.append(hero);

  const playing = player.current?.id === s.id;
  const fab = h("button", { class: "play-fab lg", "aria-label": t("common.play"), html: icon(playing && isPlaying() ? "pause" : "play", 26), dataset: { songfab: s.id },
    onclick: () => (player.current?.id === s.id ? toggle() : playRadio(s)) });
  // Shared "from this moment" links: #/song/<id>/<seconds>
  const fromBtn = at > 0 ? h("button", { class: "btn accent from-btn", onclick: () => playRadio(s, undefined, at) },
    h("span", { html: icon("play", 16) }), t("song.playFrom", { t: fmtTime(at) })) : null;
  v.append(h("div", { class: "actions" }, fab, fromBtn, heartButton(s, 28),
    h("button", { class: "icon-btn", "aria-label": t("common.share"), html: icon("share", 24), onclick: () => shareSong(s) }),
    canDownload() ? h("button", { class: "icon-btn", "aria-label": t("common.download"), html: icon("download", 24), onclick: () => downloadSong(s) }) : null,
    h("button", { class: "icon-btn", "aria-label": t("common.more"), html: icon("more", 24), onclick: () => songMenu(s) }),
    h("div", { class: "grow" })));

  const pills = [
    link(`genre/${encodeURIComponent(s.genre)}`, { class: "pill" }, `${genre(s.genre).emoji} ${genre(s.genre).label}`),
    s.subgenre ? h("span", { class: "pill" }, s.subgenre) : null,
    ...(s.moods || []).map((m) => link(`mood/${m}`, { class: "pill" }, `${mood(m).emoji} ${mood(m).label}`)),
    link(`lang/${s.language}`, { class: "pill" }, `🌐 ${lang(s.language)}`),
    s.bpm ? h("span", { class: "pill" }, `🥁 ${s.bpm} BPM`) : null,
    h("span", { class: "pill" }, `⚡ ${t("song.energy")} `, h("span", { class: "meter" }, h("i", { style: { width: `${Math.round((s.energy ?? 0.5) * 100)}%` } }))),
    s.explicit ? h("span", { class: "pill" }, "🔞 Explicit") : null,
  ];
  v.append(h("div", { class: "info-grid" }, pills));
  const desc = describe(s);
  if (desc) {
    const note = h("div", { class: "ai-note", html: icon("sparkles", 18) });
    note.append(h("div", null, desc));
    v.append(note);
  }
  if (s.tags?.length) v.append(h("div", { class: "chips", style: { marginTop: "12px", flexWrap: "wrap" } }, s.tags.map((tag) => link(`search/${encodeURIComponent(tag)}`, { class: "chip outline" }, `#${tag}`))));

  const names = { shazam: "Shazam", itunes: "iTunes", deezer: "Deezer", ai: "AI" };
  const found = (s.sources || []).map((x) => names[x]).filter(Boolean).join(" + ");
  v.append(h("p", { class: "pad muted", style: { fontSize: "12px", marginTop: "14px" } },
    [t("song.added", { when: timeAgo(Date.parse(s.addedAt || 0)) }), found ? t("song.found", { src: found }) : null,
      s.confidence != null ? t("song.confidence", { n: Math.round(s.confidence * 100) }) : null].filter(Boolean).join(" • ")));

  if (s.lyrics) {
    const box = h("div", { class: "lyrics-plain", style: { fontSize: "16px" } }, "…");
    v.append(section(t("common.lyrics"), h("div", { class: "pad" }, box)));
    getLyrics(s).then((data) => {
      const text = data?.plain || (data?.synced || []).map((l) => l[1]).join("\n");
      const lines = (text || "").split("\n");
      box.textContent = text ? lines.slice(0, 12).join("\n") + (lines.length > 12 ? "\n…" : "") : t("np.noLyrics");
    });
  }
  const similar = reco.radio(s, 10);
  if (similar.length) {
    const ctx = { type: "radio", id: s.id, title: t("ctx.radioOf", { t: s.title }) };
    const box = h("div", { class: "tracks" });
    similar.forEach((x) => box.append(songRow(x, { list: [s, ...similar], context: ctx })));
    v.append(section(t("song.similar"), box));
  }
  return v;
}

function viewPending(id) {
  const v = h("div", { class: "view" });
  v.append(topbar(t("common.song"), { back: true }));
  const box = h("div", { class: "empty" }, h("div", { class: "spinner" }), h("h3", null, t("song.pending")), h("p", null, t("song.pendingDesc")));
  v.append(box);
  let tries = 0;
  const timer = setInterval(async () => {
    tries++;
    if (!v.isConnected || tries > 20) {
      clearInterval(timer);
      if (v.isConnected) box.replaceWith(h("div", { class: "empty" }, h("h3", null, t("song.notFound")), h("p", null, t("song.notFoundDesc"))));
      return;
    }
    try { await loadLibrary(); } catch { /* retry */ }
    if (getSong(id)) { clearInterval(timer); rerender(); }
  }, 15000);
  return v;
}

// ------------------------------------------------------------------ DJ
function djTile() {
  return link("dj", { class: "quick-item dj-tile", title: t("dj.banner") },
    h("div", { class: "dj-art", html: icon("sparkles", 24) }), h("span", null, "DJ"));
}

const djChat = []; // this visit's conversation (kept while moving between pages)
let djPending = null;
/** Opens the DJ and asks it (used for "Hey Google, play … on Cavi Music"). */
export function askDJ(text) {
  djPending = text;
  go("dj");
}

export function viewDJ() {
  const v = h("div", { class: "view dj-view" });
  v.append(topbar("DJ", { back: true }));
  const log = h("div", { class: "dj-log" });
  const hello = h("div", { class: "dj-hello" },
    h("div", { class: "dj-orb big", html: icon("sparkles", 40) }),
    h("h1", null, "DJ"),
    h("p", null, t("dj.hello")));
  const chips = h("div", { class: "chips dj-chips" }, (dj.SUGGESTIONS[LANG] || dj.SUGGESTIONS.en).map((x) =>
    h("button", { class: "chip", onclick: () => send(x) }, x)));
  const input = h("input", { type: "text", placeholder: t("dj.placeholder"), enterkeyhint: "send", autocomplete: "off" });
  const form = h("form", { class: "dj-input", onsubmit: (e) => { e.preventDefault(); send(input.value); } }, input);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const mic = h("button", { type: "button", class: "dj-mic", "aria-label": t("dj.voice"), html: icon("mic", 20) });
    mic.addEventListener("click", () => {
      const rec = new SR();
      rec.lang = { uz: "uz-UZ", ru: "ru-RU", en: "en-US" }[LANG] || "ru-RU";
      rec.interimResults = false;
      mic.classList.add("on");
      input.placeholder = t("dj.listening");
      rec.onresult = (e) => { const said = e.results[0][0].transcript; input.value = said; send(said); };
      rec.onend = () => { mic.classList.remove("on"); input.placeholder = t("dj.placeholder"); };
      try { rec.start(); } catch { mic.classList.remove("on"); }
    });
    form.append(mic);
  }
  form.append(h("button", { type: "submit", class: "dj-send", "aria-label": t("dj.send"), html: icon("send", 20) }));

  const bubble = (entry) => {
    if (entry.me) return h("div", { class: "dj-msg me" }, entry.text);
    const box = h("div", { class: "dj-msg" }, h("div", { class: "dj-text" }, entry.text));
    if (entry.songs.length) {
      const ctx = { type: "mix", id: `dj-${entry.at}`, title: "DJ" };
      const list = h("div", { class: "tracks dj-tracks" });
      entry.songs.slice(0, 5).forEach((s) => list.append(songRow(s, { list: entry.songs, context: ctx, showPlays: false })));
      box.append(list, h("button", { class: "btn accent dj-play", onclick: () => playList(entry.songs, 0, ctx),
        html: `${icon("play", 16)}<span>${t("dj.playAll", { n: entry.songs.length })}</span>` }));
    }
    return box;
  };
  const draw = () => {
    log.replaceChildren(...djChat.map(bubble));
    hello.hidden = djChat.length > 0;
    requestAnimationFrame(() => document.getElementById("main")?.scrollTo({ top: 1e9, behavior: "smooth" }));
  };
  function send(text) {
    text = String(text || "").trim();
    if (!text) return;
    input.value = "";
    haptic("light");
    const answer = dj.ask(text);
    djChat.push({ me: true, text }, { text: answer.text, songs: answer.songs, at: Date.now() });
    if (djChat.length > 30) djChat.splice(0, djChat.length - 30);
    draw();
    if (answer.songs.length) playList(answer.songs, 0, { type: "mix", id: `dj-${Date.now()}`, title: "DJ" });
  }
  v.append(hello, log, h("div", { class: "dj-bottom" }, chips, form));
  draw();
  if (djPending) {
    const text = djPending;
    djPending = null;
    setTimeout(() => send(text), 250);
  }
  return v;
}

// ------------------------------------------------------------------ ADD (owner)
function openBot() {
  const url = `https://t.me/${CONFIG.botUsername}`;
  haptic("medium");
  if (tg) tg.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

export function viewAdd() {
  const v = h("div", { class: "view" });
  v.append(topbar(t("add.title"), { back: true }));
  const body = h("div", { class: "pad add-page" }, h("div", { class: "spinner" }));
  v.append(body);
  if (!inTelegram) { try { localStorage.setItem(OWNER_KEY, "1"); } catch { /* ignore */ } }
  ownerMode().then((ok) => {
    if (!ok && inTelegram) {
      body.replaceChildren(h("div", { class: "empty" }, h("div", { class: "big-ico", html: icon("user", 56) }),
        h("h3", null, t("add.ownerOnly")), h("p", null, t("add.ownerOnlyDesc")), h("a", { class: "btn", href: "#/" }, t("common.homeBtn"))));
      return;
    }
    body.replaceChildren(
      h("h1", { class: "add-title" }, t("add.title")),
      h("p", { class: "muted add-sub" }, t("add.sub", { bot: CONFIG.botUsername })),
      h("ol", { class: "add-steps" },
        [["upload", "add.step1"], ["sparkles", "add.step2"], ["note", "add.step3"]].map(([ico, key]) =>
          h("li", null, h("span", { class: "add-ico", html: icon(ico, 20) }), h("span", null, t(key))))),
      h("button", { class: "btn accent add-open", onclick: openBot, html: `${icon("send", 18)}<span>${t("add.openBot")}</span>` }),
      h("p", { class: "muted add-tip" }, t("add.formats")));
  });
  return v;
}

export function viewNotFound(msg = t("page.notFound")) {
  const v = h("div", { class: "view" });
  v.append(topbar("", { back: true }), h("div", { class: "empty" }, h("h3", null, msg), h("a", { class: "btn", href: "#/" }, t("common.homeBtn"))));
  return v;
}
