// Ads (made with /add in the bot, library/ads.json).
//  - Once a day per listener: full screen, the music pauses; "Skip" after 10 seconds.
//  - After that, silently and without pausing: in place of the cover (or as a small card above the
//    player) twice per song — at 0:50 and 50 seconds before the end.
// Views, skips, completions and clicks are counted anonymously by the relay (relay/worker.js).
import { CONFIG } from "./config.js";
import { lib, on } from "./store.js";
import { player, pause, play, isPlaying } from "./player.js";
import { h, icon } from "./ui.js";
import { t } from "./i18n.js";
import { tg, haptic } from "./tg.js";

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const uid = (() => {
  let id = store.get("ms.uid");
  if (!id || !/^[a-z0-9]{8,32}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("");
    store.set("ms.uid", id);
  }
  return id;
})();
const today = () => new Date().toLocaleDateString("sv"); // YYYY-MM-DD, local day

function track(ad, ev) {
  if (!CONFIG.statsUrl || !ad) return;
  const body = JSON.stringify({ ad: ad.id, ev, uid });
  try {
    if (!navigator.sendBeacon?.(`${CONFIG.statsUrl}/ad-event`, body)) {
      fetch(`${CONFIG.statsUrl}/ad-event`, { method: "POST", body, keepalive: true, mode: "no-cors" }).catch(() => {});
    }
  } catch { /* stats are best effort */ }
}

const activeAds = () => (lib.ads || []).filter((a) => a && a.src && a.active !== false);
function nextAd() {
  const list = activeAds();
  if (!list.length) return null;
  const i = (Number(store.get("ms.adRot")) || 0) % list.length;
  store.set("ms.adRot", String(i + 1));
  return list[i];
}

function openLink(ad) {
  if (!ad.link) return;
  track(ad, "click");
  if (tg) tg.openLink(ad.link);
  else window.open(ad.link, "_blank", "noopener");
}

function media(ad, { muted }) {
  if (ad.type === "video") {
    const v = h("video", { src: ad.src, poster: ad.poster, playsinline: true, autoplay: true, preload: "auto" });
    v.muted = muted;
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); // sound may need a tap first
    return v;
  }
  return h("img", { src: ad.src, alt: "" });
}

// ------------------------------------------------------------------ once a day: full screen, music paused
let full = null;
const fullDue = () => store.get("ms.adDay") !== today();

function showFull(ad) {
  store.set("ms.adDay", today());
  full = { ad };
  pause();
  const el = media(ad, { muted: false });
  const skip = h("button", { class: "ad-skip", disabled: true });
  const bar = h("i");
  const close = (ev) => {
    if (!full) return;
    track(ad, ev);
    full = null;
    clearInterval(timer);
    root.classList.remove("open");
    setTimeout(() => root.remove(), 250);
    play();
  };
  const root = h("div", { class: "ad-full", role: "dialog" },
    h("div", { class: "ad-top" }, h("span", { class: "ad-label" }, t("ad.label")), h("div", { class: "ad-bar" }, bar)),
    h("div", { class: "ad-media" }, el),
    h("div", { class: "ad-bottom" },
      ad.text ? h("p", null, ad.text) : null,
      h("div", { class: "ad-actions" },
        ad.link ? h("button", { class: "btn accent", onclick: () => openLink(ad) }, t("ad.open")) : null,
        skip)));
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add("open"));
  track(ad, "view");
  haptic("light");
  const started = Date.now();
  const length = ad.type === "video" ? Math.max(10, Math.min(ad.duration || 30, 60)) : 15;
  const tick = () => {
    const s = (Date.now() - started) / 1000;
    const left = Math.ceil(10 - s);
    skip.disabled = left > 0;
    skip.innerHTML = left > 0 ? t("ad.skipIn", { n: left }) : `${t("ad.skip")} ${icon("next", 14)}`;
    bar.style.width = `${Math.min(100, (s / length) * 100)}%`;
    if (ad.type !== "video" && s >= length) close("complete");
  };
  const timer = setInterval(tick, 250);
  tick();
  skip.addEventListener("click", () => close("skip"));
  if (ad.type === "video") el.addEventListener("ended", () => close("complete"));
}

// ------------------------------------------------------------------ during songs: silent, no pause
let marks = null; // per song: [{at, done}]
let inline = null;

function songMarks(d) {
  if (!d || d < 60) return [];
  return d >= 110 ? [{ at: 50 }, { at: d - 50 }] : [{ at: 50 }];
}

function showInline(ad) {
  hideInline();
  const art = document.querySelector(".np.open .np-art");
  const seconds = ad.type === "video" ? Math.max(6, Math.min(ad.duration || 10, 15)) : 8;
  const el = media(ad, { muted: true });
  const label = h("span", { class: "ad-label" }, t("ad.label"));
  let box;
  if (art) {
    box = h("div", { class: "ad-inline", onclick: () => openLink(ad) }, el, label, ad.text ? h("p", null, ad.text) : null);
    art.append(box);
  } else {
    box = h("div", { class: "ad-banner", onclick: () => openLink(ad) },
      h("div", { class: "ad-thumb" }, el),
      h("div", { class: "ad-copy" }, label, h("span", null, ad.text || t("ad.label"))),
      ad.link ? h("span", { class: "ad-go", html: icon("right", 18) }) : null);
    document.body.append(box);
  }
  requestAnimationFrame(() => box.classList.add("open"));
  track(ad, "iview");
  inline = { box, timer: setTimeout(hideInline, seconds * 1000) };
}

function hideInline() {
  if (!inline) return;
  const { box, timer } = inline;
  inline = null;
  clearTimeout(timer);
  box.classList.remove("open");
  setTimeout(() => box.remove(), 300);
}

export function initAds() {
  on("track", () => { marks = null; hideInline(); });
  on("state", ({ playing }) => {
    if (!playing) return;
    if (full) { pause(); return; } // the ad is on: the lock screen can't start the music under it
    if (fullDue() && activeAds().length && player.current) showFull(nextAd());
  });
  on("time", ({ t: time, d }) => {
    if (full || !isPlaying() || fullDue() || !activeAds().length) return;
    if (!marks) marks = songMarks(d);
    for (const m of marks) {
      if (!m.done && time >= m.at && time < m.at + 5) {
        m.done = true;
        showInline(nextAd());
      } else if (!m.done && time >= m.at + 5) m.done = true; // jumped past it
    }
  });
}
