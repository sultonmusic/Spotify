// Page views. Each returns a DOM node for #view.
import { CONFIG } from "./config.js";
import {
  lib, song as getSong, songsOf, artistNames, favSongs, recentlyPlayed, plays, user, totalPlays, artistColor, loadLibrary, coverUrl,
} from "./store.js";
import * as reco from "./reco.js";
import { player, playList, playRadio, playSong, isPlaying, setShuffle } from "./player.js";
import {
  h, icon, art, artistArt, collage, likedArt, songRow, card, section, lazyList, heartButton, go, link, toast,
  fmtTime, fmtLong, timeAgo, num, shareSong, downloadSong, songMenu, placeholder, back as goBack,
} from "./ui.js";
import { searchSongs, searchArtists, matchCategories } from "./search.js";
import { GENRES, MOODS, LANGS, genre, mood, lang } from "./i18n.js";
import { user as tgUser, canDownload } from "./tg.js";
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

function mixTitle(m, i) { return `Kunlik miks ${i + 1}`; }
function mixSub(songs) {
  const names = [];
  for (const s of songs) for (const a of s.artists) if (!names.includes(a)) names.push(a);
  return names.slice(0, 3).join(", ") + (names.length > 3 ? " va boshqalar" : "");
}

function greeting() {
  const hr = new Date().getHours();
  if (hr >= 5 && hr < 11) return "Xayrli tong";
  if (hr >= 11 && hr < 17) return "Xayrli kun";
  if (hr >= 17 && hr < 22) return "Xayrli kech";
  return "Xayrli tun";
}

function avatar() {
  const u = tgUser();
  if (u?.photo_url) return h("div", { class: "avatar" }, h("img", { src: u.photo_url, alt: "" }));
  const letter = (u?.first_name || CONFIG.appName || "M").trim()[0].toUpperCase();
  return h("div", { class: "avatar" }, letter);
}

function topbar(title, { back = false, solidOnScroll = true } = {}) {
  const bar = h("div", { class: "topbar" },
    back ? h("button", { class: "back-btn", "aria-label": "Orqaga", html: icon("back", 20), onclick: goBack }) : avatar(),
    back ? h("div", { class: "ttl" }, title) : h("h1", null, title));
  if (solidOnScroll) bar.dataset.solid = "1";
  return bar;
}

function songCard(s, list, context) {
  const playing = player.current?.id === s.id;
  return card({
    artEl: art(s), title: s.title, sub: s.artist, playing,
    onClick: () => go(`song/${s.id}`),
    onPlay: () => playSong(s, list, context),
  });
}

function shelf(items) {
  return h("div", { class: "shelf" }, items);
}

function emptyLibrary() {
  return h("div", { class: "empty" },
    h("div", { class: "big-ico", html: icon("note", 64) }),
    h("h3", null, "Kutubxona hozircha bo'sh"),
    h("p", null, "Telegram botga qo'shiq yuboring — u avtomatik aniqlanib, shu yerda paydo bo'ladi."),
    h("a", { class: "btn accent", href: `https://t.me/${CONFIG.botUsername}`, target: "_blank", rel: "noopener" },
      h("span", { html: icon("send", 18) }), `@${CONFIG.botUsername}`));
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
  const fab = h("button", { class: "play-fab lg", "aria-label": "Ijro", html: icon(playingThis() && isPlaying() ? "pause" : "play", 26) });
  fab.addEventListener("click", () => {
    if (playingThis()) { player.audio.paused ? player.audio.play() : player.audio.pause(); return; }
    playList(songs, 0, context);
  });
  fab.dataset.ctx = `${context.type}:${context.id}`;
  const shuffleBtn = h("button", { class: "icon-btn", "aria-label": "Aralash ijro", html: icon("shuffle", 26),
    onclick: () => { setShuffle(true); playList(songs, Math.floor(Math.random() * songs.length), context); toast("Aralash ijro 🔀"); } });
  return h("div", { class: "actions" }, fab, shuffleBtn, ...extra, h("div", { class: "grow" }));
}

function trackList(songs, context, { numbered = false, cover = true } = {}) {
  const box = h("div", { class: "tracks" });
  lazyList(box, songs, (s, i) => songRow(s, { list: songs, context, index: numbered ? i : null, cover }));
  return box;
}

function durationOf(songs) { return songs.reduce((a, s) => a + (s.duration || 0), 0); }
function metaLine(songs, extra) {
  return [extra, `${num(songs.length)} ta qo'shiq`, fmtLong(durationOf(songs))].filter(Boolean).join(" • ");
}

// ------------------------------------------------------------------ HOME
export function viewHome() {
  const v = h("div", { class: "view" });
  if (!lib.songs.length) {
    v.append(topbar(greeting()), emptyLibrary());
    return v;
  }
  const color = player.current?.color || reco.newest(1)[0]?.color || "#404040";
  v.append(h("div", { class: "home-bg", style: { background: `linear-gradient(${rgba(color, 0.6)}, transparent)` } }));
  v.append(topbar(greeting(), { solidOnScroll: true }));

  // mood chips
  const moodCounts = new Map();
  for (const s of lib.songs) for (const m of s.moods || []) moodCounts.set(m, (moodCounts.get(m) || 0) + 1);
  const moodsPresent = [...moodCounts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([m]) => m);
  if (moodsPresent.length) {
    v.append(h("div", { class: "chips", style: { marginBottom: "16px", position: "relative" } },
      moodsPresent.map((m) => link(`mood/${m}`, { class: "chip" }, `${mood(m).emoji} ${mood(m).label}`))));
  }

  // quick grid
  const quick = h("div", { class: "quick", style: { position: "relative" } });
  const favs = favSongs();
  if (favs.length) quick.append(link("liked", { class: "quick-item" }, likedArt(), h("span", null, "Sevimli qo'shiqlar")));
  const mx = mixes();
  if (mx[0] && lib.songs.length >= 8) quick.append(link(`mix/${mx[0].id}`, { class: "quick-item" }, collage(mx[0].songs), h("span", null, mixTitle(mx[0], 0))));
  for (const s of reco.quickPicks(8 - quick.childElementCount)) {
    const item = h("div", { class: `quick-item${player.current?.id === s.id ? " playing" : ""}`, role: "button", dataset: { qid: s.id } }, art(s), h("span", null, s.title));
    item.addEventListener("click", () => playSong(s, null, { type: "radio", id: s.id, title: `${s.title} radiosi` }));
    quick.append(item);
  }
  v.append(quick);

  const forYou = reco.forYou(20);
  v.append(section("Siz uchun", shelf(forYou.map((s) => songCard(s, forYou, { type: "mix", id: "foryou", title: "Siz uchun" }))),
    { sub: "Did-profilingiz asosida tanlandi", more: "#/mix/foryou" }));

  if (mx.length) {
    v.append(section("Kunlik mikslaringiz", shelf(mx.map((m, i) => card({
      artEl: h("div", { style: { position: "relative", width: "100%", height: "100%" } }, collage(m.songs),
        h("div", { class: "mix-band", style: { background: m.genre ? genre(m.genre).color : "#22c55e" } }),
        h("div", { class: "mix-label" }, mixTitle(m, i))),
      title: m.genre ? genre(m.genre).label : "Aralash", sub: mixSub(m.songs),
      onClick: () => go(`mix/${m.id}`), onPlay: () => playList(m.songs, 0, { type: "mix", id: m.id, title: mixTitle(m, i) }),
    })))));
  }

  const fresh = reco.newest(20);
  v.append(section("Yangi qo'shilganlar", shelf(fresh.map((s) => songCard(s, fresh, { type: "mix", id: "new", title: "Yangi qo'shilganlar" }))), { more: "#/mix/new" }));

  const recent = recentlyPlayed(20);
  if (recent.length) v.append(section("Yaqinda tinglangan", shelf(recent.map((s) => songCard(s, recent, { type: "mix", id: "recent", title: "Yaqinda tinglangan" }))), { more: "#/mix/recent" }));

  const rep = reco.onRepeat(20);
  if (rep.length >= 3) v.append(section("Takror-takror", shelf(rep.map((s) => songCard(s, rep, { type: "mix", id: "repeat", title: "Takror-takror" }))), { sub: "So'nggi 30 kunda eng ko'p qaytgan qo'shiqlaringiz", more: "#/mix/repeat" }));

  const artists = reco.artistsRanked(16);
  if (artists.length) v.append(section("Ijrochilar", shelf(artists.map((a) => card({
    artEl: artistArt(a), title: a, sub: `${songsOf(a).length} ta qo'shiq`, round: true,
    onClick: () => go(`artist/${encodeURIComponent(a)}`),
  })))));

  const disc = reco.discover(20);
  if (disc.length && user.history.length) v.append(section("Kashf eting", shelf(disc.map((s) => songCard(s, disc, { type: "mix", id: "discover", title: "Kashf eting" }))), { sub: "Hali tinglamagan, lekin sizga yoqishi mumkin", more: "#/mix/discover" }));

  const forgot = reco.forgotten(20);
  if (forgot.length >= 3) v.append(section("Unutilgan sevimlilar", shelf(forgot.map((s) => songCard(s, forgot, { type: "mix", id: "forgotten", title: "Unutilgan sevimlilar" }))), { more: "#/mix/forgotten" }));

  const top = reco.topSongs(20);
  if (top.length >= 3) v.append(section("Eng ko'p tinglanganlar", shelf(top.map((s) => songCard(s, top, { type: "mix", id: "top", title: "Eng ko'p tinglanganlar" }))), { more: "#/mix/top" }));

  v.append(section("Janrlar", genreTiles()));
  v.append(h("div", { class: "foot" }, `${num(lib.songs.length)} ta qo'shiq • `,
    h("a", { href: `https://t.me/${CONFIG.botUsername}`, target: "_blank", rel: "noopener" }, `@${CONFIG.botUsername}`),
    " orqali qo'shing"));
  return v;
}

function genreTiles(limit = 99) {
  const counts = new Map();
  for (const s of lib.songs) counts.set(s.genre, (counts.get(s.genre) || 0) + 1);
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
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
  const input = h("input", { type: "search", placeholder: "Qo'shiq, ijrochi, janr yoki kayfiyat…", value: param ?? lastQuery, enterkeyhint: "search", autocomplete: "off", "aria-label": "Qidiruv" });
  const clear = h("button", { class: "icon-btn", style: { width: "28px", height: "28px", color: "#121212" }, html: icon("close", 20), "aria-label": "Tozalash" });
  const results = h("div");
  v.append(h("div", { class: "search-box" }, h("h1", null, "Qidiruv"),
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
      results.append(h("div", { class: "empty" }, h("h3", null, `"${q}" topilmadi`),
        h("p", null, "Boshqacha yozib ko'ring yoki qo'shiqni botga yuboring.")));
      return;
    }
    const ctx = { type: "search", id: q, title: `"${q}" qidiruvi` };
    const topArtist = artists[0] && (!songs[0] || songs[0]._a !== songs[0]._t) &&
      (songs.length === 0 || songs[0].artists.includes(artists[0]) || artists[0].toLowerCase().startsWith(q.toLowerCase()));
    if (topArtist) {
      const a = artists[0];
      const el = h("div", { class: "top-result round", role: "button", onclick: () => go(`artist/${encodeURIComponent(a)}`) },
        h("div", { class: "art" }, artistArt(a)), h("div", null, h("h3", null, a), h("div", { class: "muted" }, "Ijrochi")),
        h("button", { class: "play-fab", html: icon("play", 22), onclick: (e) => { e.stopPropagation(); playList(popularOf(a), 0, { type: "artist", id: a, title: a }); } }));
      results.append(section("Eng mos natija", el));
    } else if (songs[0]) {
      const s = songs[0];
      const el = h("div", { class: "top-result", role: "button", onclick: () => go(`song/${s.id}`) },
        h("div", { class: "art" }, art(s)), h("div", null, h("h3", null, s.title), h("div", { class: "muted" }, `Qo'shiq • ${s.artist}`)),
        h("button", { class: "play-fab", html: icon("play", 22), onclick: (e) => { e.stopPropagation(); playSong(s, songs, ctx); } }));
      results.append(section("Eng mos natija", el));
    }
    if (songs.length) {
      const box = h("div", { class: "tracks" });
      lazyList(box, songs, (s) => songRow(s, { list: songs, context: ctx }), 30);
      results.append(section("Qo'shiqlar", box));
    }
    if (artists.length) results.append(section("Ijrochilar", shelf(artists.slice(0, 20).map((a) => card({ artEl: artistArt(a), title: a, sub: "Ijrochi", round: true, onClick: () => go(`artist/${encodeURIComponent(a)}`) })))));
    if (cats.length) results.append(section("Janr va kayfiyatlar", h("div", { class: "tiles" }, cats.map((c) => tile(c, `${c.type}/${encodeURIComponent(c.key)}`)))));
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
    recent.forEach((s) => box.append(songRow(s, { list: recent, context: { type: "mix", id: "recent", title: "Yaqinda tinglangan" } })));
    wrap.append(section("Yaqinda tinglangan", box));
  }
  const moodCounts = new Map();
  for (const s of lib.songs) for (const m of s.moods || []) moodCounts.set(m, (moodCounts.get(m) || 0) + 1);
  const moodList = [...moodCounts.keys()].filter((m) => MOODS[m]);
  if (moodList.length) wrap.append(section("Kayfiyatlar", h("div", { class: "tiles" }, moodList.map((m) => tile(mood(m), `mood/${m}`)))));
  wrap.append(section("Janrlar", genreTiles()));
  const langs = new Map();
  for (const s of lib.songs) langs.set(s.language, (langs.get(s.language) || 0) + 1);
  if (langs.size > 1) {
    wrap.append(section("Tillar", h("div", { class: "chips", style: { flexWrap: "wrap" } },
      [...langs.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => link(`lang/${l}`, { class: "chip" }, `${lang(l)} · ${n}`)))));
  }
  return wrap;
}

// ------------------------------------------------------------------ LIBRARY
const SORTS = {
  added: ["Qo'shilgan sana", (a, b) => Date.parse(b.addedAt || 0) - Date.parse(a.addedAt || 0)],
  title: ["Nomi (A–Z)", (a, b) => a.title.localeCompare(b.title, "uz")],
  artist: ["Ijrochi (A–Z)", (a, b) => a.artist.localeCompare(b.artist, "uz")],
  plays: ["Ko'p tinglangan", (a, b) => plays(b.id) - plays(a.id)],
  recent: ["Yaqinda tinglangan", (a, b) => (user.last[b.id] || 0) - (user.last[a.id] || 0)],
};
let sortKey = "added";

export function viewLibrary(tab = "favs") {
  const v = h("div", { class: "view" });
  v.append(topbar("Kutubxonangiz"));
  const tabs = [["favs", "Sevimlilar"], ["songs", "Qo'shiqlar"], ["artists", "Ijrochilar"], ["stats", "Statistika"]];
  v.append(h("div", { class: "lib-tabs" }, h("div", { class: "chips" },
    tabs.map(([k, label]) => h("button", { class: `chip${k === tab ? " active" : ""}`, onclick: () => location.replace(`#/library/${k}`) }, label)))));

  if (tab === "favs") {
    const favs = favSongs();
    v.append(link("liked", { class: "liked-banner" }, h("div", { class: "ico", html: icon("heartFill", 28) }),
      h("div", null, h("b", null, "Sevimli qo'shiqlar"), h("span", null, `${favs.length} ta qo'shiq`))));
    if (!favs.length) v.append(h("div", { class: "empty" }, h("div", { class: "big-ico", html: icon("heart", 64) }),
      h("h3", null, "Sevimlilar hali yo'q"), h("p", null, "Qo'shiq yonidagi ♡ tugmasini bosing — u shu yerda saqlanadi.")));
    else v.append(trackList(favs, { type: "liked", id: "liked", title: "Sevimli qo'shiqlar" }));
  } else if (tab === "songs") {
    if (!lib.songs.length) { v.append(emptyLibrary()); return v; }
    const sorted = lib.songs.slice().sort(SORTS[sortKey][1]);
    const select = h("select", { "aria-label": "Saralash" }, Object.entries(SORTS).map(([k, [label]]) => h("option", { value: k, selected: k === sortKey }, label)));
    select.addEventListener("change", () => { sortKey = select.value; rerender(); });
    v.append(h("div", { class: "lib-toolbar" }, h("span", null, metaLine(sorted)), h("label", { style: { display: "flex", alignItems: "center", gap: "4px" } }, h("span", { html: icon("sort", 16) }), select)));
    v.append(trackList(sorted, { type: "library", id: sortKey, title: "Barcha qo'shiqlar" }));
  } else if (tab === "artists") {
    const names = artistNames().sort((a, b) => a.localeCompare(b, "uz"));
    const box = h("div", { class: "tracks" });
    lazyList(box, names, (a) => {
      const n = songsOf(a).length;
      const p = songsOf(a).reduce((x, s) => x + plays(s.id), 0);
      return link(`artist/${encodeURIComponent(a)}`, { class: "row round" },
        h("div", { class: "cov-wrap" }, artistArt(a, "cov")),
        h("div", { class: "meta" }, h("div", { class: "t" }, h("span", null, a)), h("div", { class: "s" }, `Ijrochi • ${n} ta qo'shiq${p ? ` • ${num(p)} tinglash` : ""}`)));
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
  const listen = user.listen || 0;
  wrap.append(h("div", { class: "stat-cards" },
    h("div", { class: "stat" }, h("b", null, num(tp)), h("span", null, "tinglashlar")),
    h("div", { class: "stat" }, h("b", null, fmtLong(listen)), h("span", null, "tinglash vaqti")),
    h("div", { class: "stat" }, h("b", null, num(lib.songs.length)), h("span", null, "qo'shiqlar")),
    h("div", { class: "stat" }, h("b", null, num(Object.keys(user.favs).length)), h("span", null, "sevimlilar"))));
  wrap.append(h("p", { class: "pad muted", style: { fontSize: "12px", marginTop: "10px" } },
    `Tinglash hisoblanadi: qo'shiq kamida ${CONFIG.playThreshold} soniya eshitilganda (Spotify standarti). ${tgUser() ? "Telegram hisobingiz orqali barcha qurilmalarda sinxronlanadi." : ""}`));

  const top = reco.topSongs(10);
  if (top.length) {
    const box = h("div", { class: "tracks" });
    top.forEach((s, i) => box.append(songRow(s, { list: top, index: i, context: { type: "mix", id: "top", title: "Eng ko'p tinglanganlar" }, sub: `${s.artist} • ${num(plays(s.id))} marta` })));
    wrap.append(section("Eng ko'p tinglangan qo'shiqlar", box, { more: "#/mix/top" }));
  }
  const ta = reco.topArtists(8);
  if (ta.length) {
    const max = ta[0][1];
    wrap.append(section("Top ijrochilar", h("div", { class: "bars" }, ta.map(([a, n]) => link(`artist/${encodeURIComponent(a)}`, { class: "bar-row" },
      h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a),
      h("div", { class: "track" }, h("i", { style: { width: `${(n / max) * 100}%` } })), h("span", { class: "v" }, num(n)))))));
  }
  const byGenre = new Map();
  for (const s of lib.songs) byGenre.set(s.genre, (byGenre.get(s.genre) || 0) + (plays(s.id) || (tp ? 0 : 1)));
  const gl = [...byGenre.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (gl.length) {
    const max = gl[0][1];
    wrap.append(section(tp ? "Sevimli janrlaringiz" : "Kutubxonadagi janrlar", h("div", { class: "bars" }, gl.map(([g, n]) => link(`genre/${encodeURIComponent(g)}`, { class: "bar-row" },
      h("span", null, `${genre(g).emoji} ${genre(g).label}`),
      h("div", { class: "track" }, h("i", { style: { width: `${(n / max) * 100}%`, background: genre(g).color } })), h("span", { class: "v" }, num(n)))))));
  }
  const hist = user.history.slice(0, 30).map((x) => ({ ...x, s: getSong(x.id) })).filter((x) => x.s);
  if (hist.length) {
    const box = h("div", { class: "tracks" });
    hist.forEach((x) => box.append(songRow(x.s, { sub: `${x.s.artist} • ${timeAgo(x.t)}`, showPlays: false })));
    wrap.append(section("Tinglash tarixi", box));
  }
  if (!tp) wrap.append(h("div", { class: "empty" }, h("div", { class: "big-ico", html: icon("chart", 64) }), h("h3", null, "Hali statistika yo'q"), h("p", null, "Qo'shiq tinglang — hisob-kitoblar shu yerda paydo bo'ladi.")));
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
    v.append(h("div", { class: "empty" }, h("h3", null, "Bu yerda hali qo'shiq yo'q")));
    return v;
  }
  v.append(collectionActions(songs, context, extraActions));
  v.append(trackList(songs, context, { numbered: context.type !== "liked" }));
  return v;
}

export function viewLiked() {
  const songs = favSongs();
  return collectionView({ kicker: "Pleylist", title: "Sevimli qo'shiqlar", songs, artEl: likedArt(), color: "#5038a0",
    context: { type: "liked", id: "liked", title: "Sevimli qo'shiqlar" } });
}

export function viewMix(id) {
  const special = {
    foryou: ["Siz uchun", "Did-profilingiz, vaqt va kayfiyatga qarab har kuni yangilanadi.", () => reco.forYou(50)],
    new: ["Yangi qo'shilganlar", "Botga eng so'nggi yuborilgan qo'shiqlar.", () => reco.newest(100)],
    recent: ["Yaqinda tinglangan", "Oxirgi tinglagan qo'shiqlaringiz.", () => recentlyPlayed(100)],
    repeat: ["Takror-takror", "So'nggi 30 kunda eng ko'p qaytgan qo'shiqlaringiz.", () => reco.onRepeat(50)],
    discover: ["Kashf eting", "Hali tinglamagan, lekin didingizga mos qo'shiqlar.", () => reco.discover(50)],
    forgotten: ["Unutilgan sevimlilar", "Anchadan beri eshitmagan sevimli qo'shiqlaringiz.", () => reco.forgotten(50)],
    top: ["Eng ko'p tinglanganlar", "Sizning shaxsiy chartingiz.", () => reco.topSongs(100)],
  };
  if (special[id]) {
    const [title, desc, fn] = special[id];
    const songs = fn();
    return collectionView({ kicker: "Miks", title, desc, songs, artEl: collage(songs), color: songs[0]?.color, context: { type: "mix", id, title } });
  }
  const list = mixes();
  const idx = list.findIndex((m) => m.id === id);
  if (idx < 0) return viewNotFound("Miks topilmadi");
  const m = list[idx];
  return collectionView({
    kicker: "Kunlik miks", title: mixTitle(m, idx), songs: m.songs,
    desc: `${m.genre ? genre(m.genre).label + " • " : ""}${mixSub(m.songs)}. Har kuni yangilanadi.`,
    artEl: collage(m.songs), color: m.genre ? genre(m.genre).color : m.songs[0]?.color,
    context: { type: "mix", id: m.id, title: mixTitle(m, idx) },
  });
}

export function viewGenre(g) {
  const info = genre(g);
  const p = reco.profile();
  const songs = lib.songs.filter((s) => s.genre === g).map((s) => ({ s, sc: reco.score(s, p, { explore: 0.05, context: false }) }))
    .sort((a, b) => b.sc - a.sc).map((x) => x.s);
  return collectionView({ kicker: "Janr", title: info.label, songs, artEl: songs.length ? collage(songs) : placeholder(g), color: info.color,
    desc: "Sizga mosligi bo'yicha saralangan.", context: { type: "genre", id: g, title: info.label } });
}

export function viewMood(m) {
  const info = mood(m);
  const songs = reco.moodMix(m, 200);
  return collectionView({ kicker: "Kayfiyat", title: `${info.emoji} ${info.label}`, songs, artEl: songs.length ? collage(songs) : placeholder(m),
    color: info.color, desc: `${info.label} kayfiyatdagi qo'shiqlar — AI teglari asosida.`, context: { type: "mood", id: m, title: info.label } });
}

export function viewLang(l) {
  const p = reco.profile();
  const songs = lib.songs.filter((s) => s.language === l).map((s) => ({ s, sc: reco.score(s, p, { context: false }) })).sort((a, b) => b.sc - a.sc).map((x) => x.s);
  return collectionView({ kicker: "Til", title: lang(l), songs, artEl: songs.length ? collage(songs) : placeholder(l), color: songs[0]?.color,
    context: { type: "lang", id: l, title: lang(l) } });
}

function popularOf(name) {
  return songsOf(name).slice().sort((a, b) => (plays(b.id) - plays(a.id)) || (Date.parse(b.addedAt || 0) - Date.parse(a.addedAt || 0)));
}

export function viewArtist(name) {
  const songs = popularOf(name);
  if (!songs.length) return viewNotFound("Ijrochi topilmadi");
  const totalP = songs.reduce((a, s) => a + plays(s.id), 0);
  const context = { type: "artist", id: name, title: name };
  const v = h("div", { class: "view" });
  v.append(topbar(name, { back: true }));
  const hero = collectionHero({ kicker: "Ijrochi", title: name, artEl: artistArt(name), round: true, color: artistColor(name),
    meta: [`${songs.length} ta qo'shiq`, totalP ? `${num(totalP)} marta tinglangan` : null].filter(Boolean).join(" • ") });
  hero.style.marginTop = "-58px";
  v.append(hero);
  v.append(collectionActions(songs, context, [
    h("button", { class: "icon-btn", "aria-label": "Ijrochi radiosi", html: icon("radio", 24), onclick: () => playRadio(songs[0], { type: "radio", id: name, title: `${name} radiosi` }) }),
  ]));
  v.append(section("Mashhur", trackList(songs.slice(0, 10), context, { numbered: true })));
  if (songs.length > 10) {
    const rest = songs.slice().sort((a, b) => (b.year || 0) - (a.year || 0));
    v.append(section("Barcha qo'shiqlar", trackList(rest, context)));
  }
  const albums = new Map();
  for (const s of songs) if (s.album && s.album !== s.title) { if (!albums.has(s.album)) albums.set(s.album, []); albums.get(s.album).push(s); }
  if (albums.size) {
    v.append(section("Albom va singllar", shelf([...albums.entries()].map(([al, list]) => card({
      artEl: art(list[0]), title: al, sub: [list[0].year, `${list.length} ta`].filter(Boolean).join(" • "),
      onClick: () => playList(list, 0, { type: "album", id: al, title: al }), onPlay: () => playList(list, 0, { type: "album", id: al, title: al }),
    })))));
  }
  const sim = reco.similarArtists(name, 12);
  if (sim.length) v.append(section("O'xshash ijrochilar", shelf(sim.map((a) => card({ artEl: artistArt(a), title: a, sub: "Ijrochi", round: true, onClick: () => go(`artist/${encodeURIComponent(a)}`) })))));
  return v;
}

// ------------------------------------------------------------------ SONG
export function viewSong(id) {
  const s = getSong(id);
  if (!s) return viewPending(id);
  const v = h("div", { class: "view" });
  v.append(topbar(s.title, { back: true }));
  const n = plays(s.id);
  const hero = collectionHero({
    kicker: "Qo'shiq", title: s.title, artEl: art(s), color: s.color,
    meta: [
      ...s.artists.map((a, i) => [i ? h("span", null, ", ") : null, link(`artist/${encodeURIComponent(a)}`, null, h("b", null, a))]),
      s.album ? h("span", null, `• ${s.album}`) : null, s.year ? h("span", null, `• ${s.year}`) : null,
      h("span", null, `• ${fmtTime(s.duration)}`), n ? h("span", null, `• ${num(n)} marta tinglangan`) : null,
    ],
  });
  hero.style.marginTop = "-58px";
  v.append(hero);

  const playing = player.current?.id === s.id;
  const fab = h("button", { class: "play-fab lg", "aria-label": "Ijro", html: icon(playing && isPlaying() ? "pause" : "play", 26), dataset: { songfab: s.id },
    onclick: () => (playing ? (player.audio.paused ? player.audio.play() : player.audio.pause()) : playRadio(s)) });
  v.append(h("div", { class: "actions" }, fab, heartButton(s, 28),
    h("button", { class: "icon-btn", "aria-label": "Ulashish", html: icon("share", 24), onclick: () => shareSong(s) }),
    canDownload() ? h("button", { class: "icon-btn", "aria-label": "Yuklab olish", html: icon("download", 24), onclick: () => downloadSong(s) }) : null,
    h("button", { class: "icon-btn", "aria-label": "Ko'proq", html: icon("more", 24), onclick: () => songMenu(s) }),
    h("div", { class: "grow" })));

  const pills = [
    link(`genre/${encodeURIComponent(s.genre)}`, { class: "pill" }, `${genre(s.genre).emoji} ${genre(s.genre).label}`),
    s.subgenre ? h("span", { class: "pill" }, s.subgenre) : null,
    ...(s.moods || []).map((m) => link(`mood/${m}`, { class: "pill" }, `${mood(m).emoji} ${mood(m).label}`)),
    link(`lang/${s.language}`, { class: "pill" }, `🌐 ${lang(s.language)}`),
    s.bpm ? h("span", { class: "pill" }, `🥁 ${s.bpm} BPM`) : null,
    h("span", { class: "pill" }, "⚡ Energiya ", h("span", { class: "meter" }, h("i", { style: { width: `${Math.round((s.energy ?? 0.5) * 100)}%` } }))),
    s.explicit ? h("span", { class: "pill" }, "🔞 Explicit") : null,
  ];
  v.append(h("div", { class: "info-grid" }, pills));
  if (s.description) v.append(h("div", { class: "ai-note", html: `${icon("sparkles", 18)}<div></div>` }));
  if (s.description) v.lastChild.lastChild.textContent = s.description;
  if (s.tags?.length) v.append(h("div", { class: "chips", style: { marginTop: "12px", flexWrap: "wrap" } }, s.tags.map((t) => link(`search/${encodeURIComponent(t)}`, { class: "chip outline" }, `#${t}`))));

  const src = { shazam: "Shazam", itunes: "iTunes", deezer: "Deezer", ai: "AI" };
  const found = (s.sources || []).map((x) => src[x]).filter(Boolean).join(" + ");
  v.append(h("p", { class: "pad muted", style: { fontSize: "12px", marginTop: "14px" } },
    `Qo'shilgan: ${timeAgo(Date.parse(s.addedAt || 0))}`, found ? ` • Aniqlandi: ${found}` : "",
    s.confidence != null ? ` • ishonch ${Math.round(s.confidence * 100)}%` : ""));

  if (s.lyrics) {
    const box = h("div", { class: "lyrics-plain", style: { fontSize: "16px" } }, "…");
    v.append(section("Qo'shiq matni", h("div", { class: "pad" }, box)));
    getLyrics(s).then((data) => {
      const text = data?.plain || (data?.synced || []).map((l) => l[1]).join("\n");
      box.textContent = text ? text.split("\n").slice(0, 12).join("\n") + (text.split("\n").length > 12 ? "\n…" : "") : "Topilmadi";
    });
  }
  const similar = reco.radio(s, 10);
  if (similar.length) {
    const ctx = { type: "radio", id: s.id, title: `${s.title} radiosi` };
    const box = h("div", { class: "tracks" });
    similar.forEach((x) => box.append(songRow(x, { list: [s, ...similar], context: ctx })));
    v.append(section("O'xshash qo'shiqlar", box));
  }
  return v;
}

function viewPending(id) {
  const v = h("div", { class: "view" });
  v.append(topbar("Qo'shiq", { back: true }));
  const box = h("div", { class: "empty" }, h("div", { class: "spinner" }), h("h3", null, "Qo'shiq joylanmoqda…"),
    h("p", null, "Bot uni hozirgina qo'shdi — sayt 1–3 daqiqada yangilanadi. Sahifa o'zi yangilanadi."));
  v.append(box);
  let tries = 0;
  const timer = setInterval(async () => {
    tries++;
    if (!v.isConnected || tries > 20) { clearInterval(timer); if (v.isConnected) box.replaceWith(h("div", { class: "empty" }, h("h3", null, "Qo'shiq topilmadi"), h("p", null, "U o'chirilgan bo'lishi mumkin."))); return; }
    try { await loadLibrary(); } catch { /* retry */ }
    if (getSong(id)) { clearInterval(timer); rerender(); }
  }, 15000);
  return v;
}

export function viewNotFound(msg = "Sahifa topilmadi") {
  const v = h("div", { class: "view" });
  v.append(topbar("", { back: true }), h("div", { class: "empty" }, h("h3", null, msg), h("a", { class: "btn", href: "#/" }, "Bosh sahifa")));
  return v;
}

export { coverUrl };
