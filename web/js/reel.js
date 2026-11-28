// Instagram Reels in the DJ and «Qo'shiq qo'shish» chats: the owner's phone (download helper) opens the Reel
// and sends back ~24 s of its audio; here it becomes a Shazam signature (like the microphone search), the
// song is recognised, and the listener is asked whether to add it. While the phone is asleep or off the
// Reel waits in the queue and is opened when the phone is back.
import { CONFIG } from "./config.js";
import { loadVibra, fingerprint, stationMatch } from "./audio-search.js";
import { lib } from "./store.js";
import { norm } from "./search.js";
import { h, icon } from "./ui.js";
import { t } from "./i18n.js";

const REEL_RE = /https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:reel|reels|p)\/[A-Za-z0-9_-]{5,40}\/?(?:\?[^\s]*)?/i;
/** The Instagram Reel link in a message, or null. */
export function reelUrl(text) {
  const m = REEL_RE.exec(String(text || ""));
  return m ? m[0].replace(/^http:/i, "https:") : null;
}

async function relay(path, options = {}) {
  const response = await fetch(`${CONFIG.statsUrl}${path}`, { cache: "no-store", ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

/** The station song with this title and artist, if it has one. */
export function stationCopy(title, artist) {
  const a = norm(artist), ti = norm(String(title || "").replace(/\s*[([].*?[)\]]/g, ""));
  return lib.songs.find((s) => s.src && !s.previewOnly && norm(String(s.title).replace(/\s*[([].*?[)\]]/g, "")) === ti &&
    (norm(s.artist) === a || (s.artists || []).some((x) => a.includes(norm(x))))) || null;
}

function pcmFromBase64(b64) {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 32768) v -= 65536;
    pcm[i] = v / 32768;
  }
  return pcm;
}

/** The Reel's audio → {title, artist, cover} (Shazam, then the station's own fingerprints), or null. */
async function recognize(b64, rate) {
  const pcm = pcmFromBase64(b64);
  const mod = await loadVibra();
  const win = rate * 12; // the window the Shazam app sends: shorter ones miss songs under talking
  const signatures = [];
  for (let start = 0; start + rate * 4 <= pcm.length && signatures.length < 3; start += win) {
    try { signatures.push(fingerprint(mod, pcm.subarray(start, Math.min(pcm.length, start + win)), rate)); } catch { /* silent piece */ }
  }
  for (const sig of signatures) {
    let data;
    try {
      data = await relay("/identify", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sig, recognizeOnly: true }) });
    } catch { continue; }
    const tr = data.track;
    if (tr?.title) {
      return { title: tr.title, artist: tr.subtitle || "", cover: tr.images?.coverarthq || tr.images?.coverart || "" };
    }
  }
  for (const sig of signatures) {
    const own = await stationMatch(sig.uri).catch(() => null);
    if (own) return { title: own.title, artist: own.subtitle, cover: own.images?.coverart || "", existingId: own.existingId };
  }
  return null;
}

const running = new Set();
/** Works through a Reel entry: reel = {url, status, jobId, ...}. save() is called after every change. */
export async function runReel(reel, save) {
  if (running.has(reel)) return;
  running.add(reel);
  try {
    if (!reel.jobId) {
      reel.status = "sending";
      save();
      const res = await relay("/api/music/reel", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: reel.url }) });
      reel.jobId = res.jobId;
      reel.status = res.helperOnline ? "working" : "waiting";
      reel.since = Date.now();
      save();
    }
    let failures = 0;
    for (;;) {
      if (!["waiting", "working", "recognizing"].includes(reel.status)) return;
      await new Promise((r) => setTimeout(r, reel.status === "waiting" ? 8000 : 4000));
      let job;
      try { job = await relay(`/api/music/reel/${reel.jobId}`); failures = 0; }
      catch (error) {
        if (++failures >= 8) { reel.status = "failed"; reel.message = String(error.message || ""); save(); return; }
        continue;
      }
      if (job.status === "failed") { reel.status = "failed"; reel.message = job.error || ""; save(); return; }
      if (job.status === "done") {
        reel.status = "recognizing";
        save();
        let found = null;
        try { found = await recognize(job.pcm, job.rate || 16000); } catch { /* fall back to Instagram's own label */ }
        if (!found && job.track) found = { title: job.track, artist: job.artist || "", hint: true };
        if (found) {
          const copy = found.existingId ? lib.byId.get(found.existingId) : stationCopy(found.title, found.artist);
          if (copy?.cover && !found.cover) found.cover = copy.cover;
          Object.assign(reel, { status: "found", track: found, existingId: copy?.id || found.existingId || null });
        } else reel.status = "none";
        save();
        return;
      }
      const next = job.status === "waiting" ? "waiting" : "working";
      if (next !== reel.status) { reel.status = next; reel.since = Date.now(); save(); }
      // claimed by the phone but nothing came back (the phone went off mid-way)
      if (reel.status === "working" && Date.now() - (reel.since || 0) > 6 * 60_000) {
        reel.status = "failed"; reel.message = t("reel.timeout"); save(); return;
      }
    }
  } catch (error) {
    reel.status = "failed";
    reel.message = String(error.message || "");
    save();
  } finally {
    running.delete(reel);
  }
}

/** The chat card for a Reel. actions: {add, no, play(id), retry} */
export function reelCard(reel, actions) {
  const box = h("div", { class: "dj-msg ac-reply reel-card" });
  const say = (text) => box.append(h("div", { class: "dj-text" }, text));
  switch (reel.status) {
    case "sending": case "working": say(t("reel.working")); break;
    case "waiting": say(t("reel.waiting")); break;
    case "recognizing": say(t("reel.recognizing")); break;
    case "none": say(t("reel.none")); break;
    case "failed":
      say(t("reel.failed"));
      if (reel.message) box.append(h("div", { class: "dj-catalog-status" }, reel.message));
      box.append(h("button", { class: "btn accent dj-play", onclick: actions.retry }, t("addchat.retry")));
      break;
    default: {
      const tr = reel.track || {};
      say(reel.existingId ? t("reel.foundHave") : tr.hint ? t("reel.foundHint") : t("reel.found"));
      const art = tr.cover ? h("img", { class: "reel-cover", src: tr.cover, alt: "", loading: "lazy" })
        : h("span", { class: "reel-cover", html: icon("note", 22) });
      box.append(h("div", { class: "dj-catalog-item" }, art,
        h("div", { class: "dj-catalog-info" }, h("b", null, tr.title || ""), h("span", null, tr.artist || ""))));
      if (reel.existingId) {
        box.append(h("button", { class: "btn accent dj-play", onclick: () => actions.play(reel.existingId),
          html: `${icon("play", 16)}<span>${t("common.play")}</span>` }));
      } else if (reel.status === "found") {
        box.append(h("div", { class: "dj-text" }, t("reel.ask")),
          h("div", { class: "reel-actions" },
            h("button", { class: "btn accent", onclick: actions.add }, h("span", { html: icon("plus", 14) }), h("span", null, t("reel.add"))),
            h("button", { class: "btn", onclick: actions.no }, t("reel.no"))));
      } else if (reel.status === "added") say(t("reel.added")); // "asked" (DJ): the DJ's own message follows
      else if (reel.status === "declined") say(t("reel.declined"));
    }
  }
  return box;
}

/** Picks up Reels that were still waiting when the page was closed. */
export function resumeReels(reels, save) {
  for (const reel of reels) if (["sending", "waiting", "working", "recognizing"].includes(reel.status)) {
    if (reel.status === "sending" && !reel.jobId) { reel.status = "failed"; save(); continue; }
    if (reel.status === "recognizing") reel.status = "working";
    runReel(reel, save);
  }
}
