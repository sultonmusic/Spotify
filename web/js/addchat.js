// «Qo'shiq qo'shish»: a chat only for adding songs to the station. Each line is a song or an artist; the
// station adds the first original result of each line (one by one, skipping the ones it already has).
// Messages longer than 5 lines are sent as a .txt file. The conversation is kept on the device.
import { lib, song as getSong, loadLibrary } from "./store.js";
import { playSong } from "./player.js";
import { h, icon, toast, openSheet, sheetItem } from "./ui.js";
import { norm } from "./search.js";
import { requestDjBatch, getDjRequest } from "./music-api.js";
import { t } from "./i18n.js";
import { haptic } from "./tg.js";
import { reelUrl, runReel, reelCard, resumeReels } from "./reel.js";

const KEY = "ms.addchat.v1";
const FILE_LINES = 5; // more lines than this → sent as a .txt file
const MAX_LINES = 300;
const SHOWN = 8;

let chat = load();
chat.forEach((e) => { if (!e.me && e.status === "sending") e.status = "failed"; }); // closed while sending
let poller = null;
let redraw = () => {};

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function save() {
  if (chat.length > 120) chat.splice(0, chat.length - 120);
  try { localStorage.setItem(KEY, JSON.stringify(chat)); } catch { /* storage full: keep in memory */ }
}

// ------------------------------------------------------------------ matching against the station
const base = (title) => norm(String(title || "").replace(/\s*[([].*?[)\]]/g, ""));
/** A station song this line names exactly: every word of the line in "artist + title", whole title in the line. */
function localMatch(line) {
  const q = ` ${norm(line)} `;
  const words = q.trim().split(" ").filter((w) => w.length >= 2);
  if (!words.length) return null;
  for (const s of lib.songs) {
    if (!s.src || s.previewOnly) continue;
    const hay = ` ${norm(`${(s.artists || [s.artist]).join(" ")} ${s.title}`)} `;
    const title = base(s.title);
    if (title && q.includes(` ${title} `) && words.every((w) => hay.includes(` ${w} `))) return s;
  }
  return null;
}

// ------------------------------------------------------------------ requests
function counts(entry) {
  const c = { a: 0, d: 0, x: 0, f: 0, wait: 0 };
  entry.items.forEach((it) => { if (it) c[it[0]] = (c[it[0]] || 0) + 1; else c.wait++; });
  return c;
}

async function start(entry) {
  entry.items = entry.queries.map((q) => { const s = localMatch(q); return s ? ["d", s.id] : null; });
  entry.map = entry.items.map((it, i) => (it ? -1 : i)).filter((i) => i >= 0);
  entry.message = "";
  if (!entry.map.length) { entry.status = "done"; save(); redraw(); return; }
  entry.status = "sending";
  save(); redraw();
  try {
    const res = await requestDjBatch(entry.map.map((i) => entry.queries[i]));
    if (!res.jobId) throw new Error(res.error || "no job");
    entry.jobId = res.jobId;
    entry.status = "running";
  } catch (error) {
    entry.status = error.helperOffline ? "offline" : "failed";
    entry.message = error.helperOffline ? "" : String(error.message || "");
  }
  save(); redraw();
  ensurePolling();
}

let lastReload = 0;
async function pollOnce() {
  const running = chat.filter((e) => !e.me && e.status === "running" && e.jobId);
  if (!running.length) { clearInterval(poller); poller = null; return; }
  let changed = false, newSongs = false, finished = false;
  for (const entry of running) {
    let job;
    try { job = await getDjRequest(entry.jobId); } catch { continue; }
    (job.items || []).forEach((it, k) => {
      const at = entry.map[k];
      if (at === undefined || !Array.isArray(it)) return;
      if (JSON.stringify(entry.items[at]) !== JSON.stringify(it)) {
        entry.items[at] = it;
        changed = true;
        if (it[0] === "a") newSongs = true;
      }
    });
    if (job.status === "COMPLETED" || job.status === "DUPLICATE") { entry.status = "done"; finished = changed = true; }
    else if (job.status === "FAILED") { entry.status = "failed"; entry.message = job.message || ""; finished = changed = true; }
    else if (entry.message !== (job.message || "")) { entry.message = job.message || ""; changed = true; }
  }
  // added songs appear on the site after it redeploys: refresh the catalog now and then
  if ((newSongs || finished || chat.some((e) => !e.me && e.items?.some((it) => it?.[0] === "a" && !getSong(it[1]))))
      && Date.now() - lastReload > 45_000) {
    lastReload = Date.now();
    await loadLibrary().catch(() => {});
    changed = true;
  }
  if (changed) { save(); redraw(); }
}

function ensurePolling() {
  if (!poller && chat.some((e) => !e.me && e.status === "running")) poller = setInterval(pollOnce, 6000);
}

// Instagram Reels: the song in the Reel is recognised and the listener is asked whether to add it
const persist = () => { save(); redraw(); };
function sendReel(url, at) {
  chat.push({ id: `m${at}`, me: true, kind: "text", text: url, at });
  const entry = { id: `g${at}`, me: false, kind: "reel", reel: { url, status: "sending" }, at };
  chat.push(entry);
  persist();
  runReel(entry.reel, persist);
}
function reelActions(entry) {
  return {
    add: () => {
      const tr = entry.reel.track || {};
      entry.reel.status = "added";
      persist();
      send(tr.artist ? `${tr.artist} - ${tr.title}` : tr.title);
    },
    no: () => { entry.reel.status = "declined"; persist(); },
    play: (id) => { const s = getSong(id); if (s) playSong(s, [s], { type: "search", id: s.id, title: s.title }); },
    retry: () => { entry.reel = { url: entry.reel.url, status: "sending" }; persist(); runReel(entry.reel, persist); },
  };
}

function send(text) {
  let lines = String(text || "").split(/\r?\n/).map((l) => l.replace(/^\s*(?:\d{1,3}[.)]|[-•*–])\s+/, "").trim()).filter(Boolean);
  if (!lines.length) return false;
  const reels = lines.map(reelUrl).filter(Boolean);
  if (reels.length) {
    reels.slice(0, 5).forEach((url, i) => sendReel(url, Date.now() + i));
    lines = lines.filter((l) => !reelUrl(l));
    if (!lines.length) return true;
  }
  if (lines.length > MAX_LINES) { toast(t("addchat.tooMany", { n: MAX_LINES })); return false; }
  const at = Date.now();
  const content = lines.join("\n");
  const asFile = lines.length > FILE_LINES;
  chat.push(asFile
    ? { id: `m${at}`, me: true, kind: "file", text: content, count: lines.length, size: new Blob([content]).size,
      fileName: `qoshiqlar-${lines.length}.txt`, at }
    : { id: `m${at}`, me: true, kind: "text", text: content, at });
  const entry = { id: `r${at}`, me: false, queries: lines, items: lines.map(() => null), status: "sending", at };
  chat.push(entry);
  save(); redraw();
  start(entry);
  return true;
}

// ------------------------------------------------------------------ view
function fileCard(entry) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([entry.text], { type: "text/plain;charset=utf-8" }));
    const a = h("a", { href: url, download: entry.fileName });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const kb = Math.max(1, Math.round(entry.size / 1024));
  return h("div", { class: "dj-msg me ac-file", role: "button", onclick: download },
    h("span", { class: "ac-file-ico", html: icon("note", 22) }),
    h("span", { class: "ac-file-info" }, h("b", null, entry.fileName),
      h("span", null, t("addchat.fileInfo", { n: entry.count, kb }))));
}

const CODE_ICON = { a: "✅", d: "☑️", x: "🔎", f: "❌" };

function botBubble(entry) {
  const c = counts(entry);
  const total = entry.queries.length;
  const done = total - c.wait;
  const head = {
    sending: t("addchat.sending"),
    running: t("addchat.running", { done, total }),
    done: t("addchat.done"),
    offline: t("addchat.offline"),
    failed: t("addchat.failed"),
  }[entry.status] || "";
  const box = h("div", { class: "dj-msg ac-reply" }, h("div", { class: "dj-text" }, head));
  const parts = [];
  if (c.a) parts.push(`✅ ${t("addchat.added", { n: c.a })}`);
  if (c.d) parts.push(`☑️ ${t("addchat.had", { n: c.d })}`);
  if (c.x) parts.push(`🔎 ${t("addchat.notFound", { n: c.x })}`);
  if (c.f) parts.push(`❌ ${t("addchat.errors", { n: c.f })}`);
  if (c.wait && entry.status === "running") parts.push(`⏳ ${t("addchat.waiting", { n: c.wait })}`);
  if (parts.length) box.append(h("div", { class: "ac-counts" }, parts.join(" · ")));
  if (entry.status === "running" || entry.status === "sending") {
    box.append(h("div", { class: "ac-bar" }, h("i", { style: { width: `${Math.round((done / total) * 100)}%` } })));
  }
  if (entry.message && entry.status !== "done") box.append(h("div", { class: "dj-catalog-status" }, entry.message));

  const rows = h("div", { class: "ac-rows" });
  const shown = entry.expanded ? entry.queries : entry.queries.slice(0, SHOWN);
  shown.forEach((q, i) => {
    const it = entry.items[i];
    const s = it?.[1] && getSong(it[1]);
    const mark = it ? CODE_ICON[it[0]] || "•" : (entry.status === "running" || entry.status === "sending" ? "⏳" : "•");
    rows.append(h("div", { class: "ac-row" },
      h("span", { class: "ac-mark" }, mark),
      h("span", { class: "ac-q" }, s ? `${s.artist} — ${s.title}` : q),
      s ? h("button", { class: "ac-play", "aria-label": t("common.play"), html: icon("play", 14),
        onclick: () => playSong(s, [s], { type: "search", id: s.id, title: s.title }) }) : null));
  });
  box.append(rows);
  if (entry.queries.length > SHOWN) {
    box.append(h("button", { class: "ac-more", onclick: () => { entry.expanded = !entry.expanded; save(); redraw(); } },
      entry.expanded ? t("addchat.showLess") : t("addchat.showAll", { n: entry.queries.length })));
  }
  if (entry.status === "offline" || entry.status === "failed") {
    box.append(h("button", { class: "btn accent dj-play", onclick: () => start(entry) }, t("addchat.retry")));
  } else if (entry.status === "done" && c.f) {
    // only the lines that failed go again (as a new message)
    const failed = entry.queries.filter((_, i) => entry.items[i]?.[0] === "f");
    box.append(h("button", { class: "btn accent dj-play", onclick: () => { send(failed.join("\n")); } },
      t("addchat.retryFailed", { n: failed.length })));
  }
  return box;
}

export function viewAddChat() {
  const v = h("div", { class: "view dj-view ac-view" });
  const menu = h("button", { class: "icon-btn", "aria-label": t("addchat.menu"), html: icon("more", 22), onclick: () => {
    openSheet((sheet, dismiss) => sheet.append(sheetItem("close", t("addchat.clear"), () => {
      chat = [];
      save(); redraw(); dismiss();
      toast(t("addchat.cleared"));
    })));
  } });
  v.append(h("div", { class: "topbar" }, h("h1", null, t("addchat.title")), h("span", { style: { flex: "1" } }), menu));
  const hello = h("div", { class: "dj-hello" },
    h("div", { class: "dj-orb big", html: icon("plus", 40) }),
    h("h1", null, t("addchat.title")),
    h("p", null, t("addchat.hello")));
  const log = h("div", { class: "dj-log" });
  const input = h("textarea", { rows: 1, placeholder: t("addchat.placeholder"), autocomplete: "off", class: "ac-text" });
  const grow = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; };
  input.addEventListener("input", grow);
  const submit = () => {
    if (send(input.value)) {
      haptic("light"); input.value = ""; grow();
      requestAnimationFrame(() => document.getElementById("main")?.scrollTo({ top: 1e9, behavior: "smooth" }));
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer: fine)").matches) { e.preventDefault(); submit(); }
  });
  const form = h("form", { class: "dj-input ac-form", onsubmit: (e) => { e.preventDefault(); submit(); } }, input,
    h("button", { type: "submit", class: "dj-send", "aria-label": t("dj.send"), html: icon("send", 20) }));

  redraw = () => {
    if (!v.isConnected && log.childElementCount) return;
    log.replaceChildren(...chat.map((e) => (e.me ? (e.kind === "file" ? fileCard(e) : h("div", { class: "dj-msg me ac-me" }, e.text))
      : e.kind === "reel" ? reelCard(e.reel, reelActions(e)) : botBubble(e))));
    hello.hidden = chat.length > 0;
  };
  redraw();
  v.append(hello, log, h("div", { class: "dj-bottom" }, form));
  requestAnimationFrame(() => document.getElementById("main")?.scrollTo({ top: 1e9 }));
  ensurePolling();
  return v;
}

// keep following lists that are still being added (and Reels still waiting for the phone) after a reload
ensurePolling();
resumeReels(chat.filter((e) => e.kind === "reel").map((e) => e.reel), persist);
