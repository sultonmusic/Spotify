// Sharing: links that start at a moment of the song, and 9:16 story cards (cover or up to 4 lyric
// lines) for Instagram / Telegram / WhatsApp — as a picture, or as a 15-second video with the song's sound.
import { h, toast, openSheet, sheetItem, siteUrl, fmtTime } from "./ui.js";
import { coverUrl } from "./store.js";
import { t } from "./i18n.js";
import { tg, haptic } from "./tg.js";
import { CONFIG } from "./config.js";

export function songLink(s, at = 0) {
  return `${siteUrl()}#/song/${s.id}${at >= 1 ? `/${Math.floor(at)}` : ""}`;
}

const abs = (url) => new URL(url, location.href).href;

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function coverFit(ctx, img, x, y, size) {
  const side = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, x, y, size, size);
}

const FONT = '"Inter", -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const W = 1080, H = 1920;
const CARD_X = 90, CARD_W = W - 180, PAD = 64;

async function assets(s) {
  try { await document.fonts?.ready; } catch { /* ignore */ }
  const [img, logo] = await Promise.all([loadImage(coverUrl(s)), loadImage("icons/icon-192.png")]);
  return { img, logo };
}

/** Everything that doesn't move: background, card, header, footer. Returns where the lyric lines go. */
function paintStatic(ctx, s, lines, { img, logo }) {
  const color = s.color || "#3a3a3a";
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, color); bg.addColorStop(1, "#070707");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (img) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.filter = "blur(70px)";
    coverFit(ctx, img, -300, -150, H * 0.9);
    ctx.restore();
    ctx.filter = "none";
    const shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, "rgba(0,0,0,.15)"); shade.addColorStop(1, "rgba(0,0,0,.75)");
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
  }

  let geo;
  const artists = (s.artists || [s.artist]).join(", ");
  if (lines.length) {
    // Lyrics card (song colour): header with cover + title, then the chosen lines
    const blocks = lines.map((l) => {
      ctx.font = `800 64px ${FONT}`;
      const main = wrap(ctx, l.text, CARD_W - PAD * 2);
      ctx.font = `500 38px ${FONT}`;
      const tr = l.tr ? wrap(ctx, l.tr, CARD_W - PAD * 2) : [];
      return { line: l, main, tr };
    });
    const bodyH = blocks.reduce((a, b) => a + b.main.length * 78 + b.tr.length * 48 + 30, 0);
    const cardH = PAD + 150 + 50 + bodyH + PAD - 30;
    const cardY = Math.max(150, (H - cardH) / 2 - 60);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 60; ctx.shadowOffsetY = 20;
    roundRect(ctx, CARD_X, cardY, CARD_W, cardH, 48);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
    if (img) {
      ctx.save(); roundRect(ctx, CARD_X + PAD, cardY + PAD, 150, 150, 16); ctx.clip();
      coverFit(ctx, img, CARD_X + PAD, cardY + PAD, 150); ctx.restore();
    }
    ctx.fillStyle = "#fff"; ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.font = `800 46px ${FONT}`;
    ctx.fillText(wrap(ctx, s.title, CARD_W - PAD * 2 - 180)[0] || "", CARD_X + PAD + 180, cardY + PAD + 30);
    ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.font = `500 36px ${FONT}`;
    ctx.fillText(wrap(ctx, artists, CARD_W - PAD * 2 - 180)[0] || "", CARD_X + PAD + 180, cardY + PAD + 90);
    geo = { blocks, y: cardY + PAD + 150 + 50, barY: cardY + cardH + 36 };
  } else {
    // Song card: big cover, title, artist
    const size = 760, x = (W - size) / 2, y = 380;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 80; ctx.shadowOffsetY = 30;
    roundRect(ctx, x, y, size, size, 28); ctx.fillStyle = color; ctx.fill();
    ctx.restore();
    if (img) { ctx.save(); roundRect(ctx, x, y, size, size, 28); ctx.clip(); coverFit(ctx, img, x, y, size); ctx.restore(); }
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = "#fff";
    ctx.font = `800 72px ${FONT}`;
    let ty = y + size + 80;
    for (const line of wrap(ctx, s.title, W - 160).slice(0, 2)) { ctx.fillText(line, W / 2, ty); ty += 86; }
    ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.font = `500 46px ${FONT}`;
    ctx.fillText(wrap(ctx, artists, W - 160)[0] || "", W / 2, ty + 10);
    ctx.textAlign = "left";
    geo = { blocks: [], y: 0, barY: ty + 110 };
  }

  // footer: platform logo + name + address
  const fy = H - 190;
  ctx.save();
  ctx.beginPath(); ctx.arc(W / 2 - 170, fy + 34, 36, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = "#000"; ctx.fill();
  if (logo) { ctx.clip(); ctx.drawImage(logo, W / 2 - 206, fy - 2, 72, 72); }
  ctx.restore();
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff"; ctx.font = `800 48px ${FONT}`; ctx.textAlign = "left";
  ctx.fillText(CONFIG.appName, W / 2 - 115, fy + 36);
  ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = `500 30px ${FONT}`; ctx.textAlign = "center";
  ctx.fillText(siteUrl().replace(/^https?:\/\//, "").replace(/\/$/, ""), W / 2, fy + 110);
  ctx.textAlign = "left";
  return geo;
}

/** The lyric lines. now = song time (video): the line being sung is bright, the others dimmed. */
function paintLines(ctx, geo, now = null) {
  let y = geo.y;
  ctx.textBaseline = "top"; ctx.textAlign = "left";
  for (const b of geo.blocks) {
    const l = b.line;
    const live = now == null || !l.timed || (now >= l.at - 0.15 && now < l.end);
    ctx.globalAlpha = live ? 1 : 0.42;
    ctx.fillStyle = "#fff"; ctx.font = `800 64px ${FONT}`;
    for (const line of b.main) { ctx.fillText(line, CARD_X + PAD, y); y += 78; }
    ctx.fillStyle = "rgba(255,255,255,.72)"; ctx.font = `500 38px ${FONT}`;
    for (const line of b.tr) { ctx.fillText(line, CARD_X + PAD, y); y += 48; }
    y += 30;
  }
  ctx.globalAlpha = 1;
}

/** Draws the story card. lines: [{text, tr, at, end}] (0–4 lyric lines). Returns a JPEG blob. */
export async function renderStory(s, lines = []) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const geo = paintStatic(ctx, s, lines, await assets(s));
  paintLines(ctx, geo);
  return new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.92));
}

// ------------------------------------------------------------------ video stories (picture + sound)
const VIDEO_TYPES = ["video/mp4;codecs=avc1.42E01F,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4",
  "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const videoType = () => (window.MediaRecorder ? VIDEO_TYPES.find((x) => MediaRecorder.isTypeSupported?.(x)) : null) || null;

/** The song's own file (on this site) + a browser that can record canvas and sound together. */
export function canMakeVideo(s) {
  try {
    return !!(s?.src && new URL(s.src, location.href).origin === location.origin && videoType()
      && HTMLCanvasElement.prototype.captureStream && (window.AudioContext || window.webkitAudioContext));
  } catch { return false; }
}

/**
 * Records a story video (up to 15 s, 720×1280) with the song's sound: from the first chosen lyric line
 * (karaoke highlight) or, for the song card, from `at`. Runs in real time. Returns { blob, ext }.
 */
export async function makeStoryVideo(s, lines = [], at = 0, onProgress = () => {}) {
  const type = videoType();
  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = new AC();
  try {
    await actx.resume();
    const [buf, art] = await Promise.all([
      fetch(s.src).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then((b) => new Promise((ok, bad) => actx.decodeAudioData(b, ok, bad))),
      assets(s),
    ]);
    const timed = lines.length > 0 && lines.every((l) => l.timed);
    let start = timed ? Math.max(0, lines[0].at - 0.8) : Math.max(0, Math.min(at || 0, buf.duration - 8));
    let end = timed ? lines[lines.length - 1].end + 0.8 : start + 15;
    end = Math.min(end, start + 15, buf.duration);
    if (end - start < 6) { end = Math.min(buf.duration, start + 6); start = Math.max(0, end - 6); }
    const dur = end - start;

    const still = document.createElement("canvas");
    still.width = W; still.height = H;
    const geo = paintStatic(still.getContext("2d"), s, lines, art);
    const c = document.createElement("canvas");
    c.width = 720; c.height = 1280;
    const ctx = c.getContext("2d");
    ctx.scale(720 / W, 1280 / H);
    const frame = (now, p) => {
      ctx.drawImage(still, 0, 0, W, H);
      paintLines(ctx, geo, timed ? now : null);
      // progress bar under the card
      ctx.fillStyle = "rgba(255,255,255,.25)"; roundRect(ctx, CARD_X, geo.barY, CARD_W, 8, 4); ctx.fill();
      ctx.fillStyle = "#fff"; roundRect(ctx, CARD_X, geo.barY, Math.max(8, CARD_W * p), 8, 4); ctx.fill();
    };
    frame(start, 0);

    const video = c.captureStream(30);
    const dest = actx.createMediaStreamDestination();
    const src = actx.createBufferSource();
    src.buffer = buf;
    const gain = actx.createGain();
    src.connect(gain).connect(dest);
    const stream = new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { rec.onstop = resolve; });

    rec.start(250);
    const t0 = actx.currentTime + 0.1;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(1, t0 + 0.35);
    gain.gain.setValueAtTime(1, t0 + dur - 0.7);
    gain.gain.linearRampToValueAtTime(0, t0 + dur);
    src.start(t0, start, dur);
    await new Promise((resolve) => {
      let finished = false;
      const finish = () => { if (!finished) { finished = true; resolve(); } };
      const tick = () => {
        const el = Math.max(0, actx.currentTime - t0);
        frame(start + el, Math.min(1, el / dur));
        onProgress(Math.min(1, el / dur));
        if (el >= dur + 0.15) finish(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(finish, (dur + 2) * 1000); // safety net if animation frames pause
    });
    rec.stop();
    await stopped;
    stream.getTracks().forEach((tr) => tr.stop());
    const mime = type.split(";")[0];
    return { blob: new Blob(chunks, { type: mime }), ext: mime === "video/mp4" ? "mp4" : "webm" };
  } finally {
    actx.close().catch(() => {});
  }
}

// ------------------------------------------------------------------ share sheet
function canShareFiles(file) {
  try { return !!navigator.canShare && navigator.canShare({ files: [file] }); } catch { return false; }
}

const tgStoriesSupported = () => !!tg && typeof tg.shareToStory === "function" && tg.isVersionAtLeast?.("7.8");

function copy(text) {
  (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast(t("toast.copied")), () => toast(text, 5000));
}

/**
 * Shares a story file through the phone's share sheet. Instagram gets only the picture/video, so the song's
 * link is copied first: in the story editor it goes into the "Link" sticker (text in a picture is never tappable).
 */
function shareFile(file, s, link) {
  navigator.clipboard?.writeText(link).catch(() => {});
  haptic("medium");
  navigator.share({ files: [file], title: `${s.artist} — ${s.title}` })
    .then(() => toast(t("share.linkHint"), 7000))
    .catch(() => { /* cancelled */ });
}

function saveFile(url, name) {
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
}

/** Story preview + every way to share it. lines: [{text, tr, at, end}]; at: where the song card video starts. */
export async function openStory(s, lines = [], at = 0) {
  toast(t("share.making"), 1500);
  const blob = await renderStory(s, lines);
  if (!blob) return;
  if (lines.length) at = lines[0].at || 0;
  const link = songLink(s, at);
  const base = `${s.artist} - ${s.title}`.replace(/[\\/:*?"<>|]+/g, " ");
  const file = new File([blob], `cavi-music-${s.id}.jpg`, { type: "image/jpeg" });
  const url = URL.createObjectURL(blob);
  openSheet((sheet, dismiss) => {
    const preview = h("div", { class: "story-frame" }, h("img", { src: url, alt: "" }));
    const items = h("div");
    sheet.append(h("div", { class: "story-preview" }, preview), items);

    // Inside Telegram the video can only be recorded if it can also be handed to another app.
    const videoShareable = () => canShareFiles(new File([new Blob()], "x.mp4", { type: (videoType() || "").split(";")[0] }));
    if (canMakeVideo(s) && (!tg || videoShareable())) {
      const videoItem = sheetItem("note", t("share.video"), async () => {
        videoItem.disabled = true;
        const bar = h("i");
        const label = h("span", null, t("share.videoMaking", { n: 0 }));
        preview.replaceChildren(h("img", { src: url, alt: "" }),
          h("div", { class: "story-progress" }, label, h("div", { class: "story-bar" }, bar), h("small", null, t("share.videoKeep"))));
        let result;
        try {
          result = await makeStoryVideo(s, lines, at, (p) => {
            bar.style.width = `${Math.round(p * 100)}%`;
            label.textContent = t("share.videoMaking", { n: Math.round(p * 100) });
          });
        } catch (e) {
          console.warn(e);
          toast(t("share.videoFail"), 4000);
          preview.replaceChildren(h("img", { src: url, alt: "" }));
          videoItem.disabled = false;
          return;
        }
        haptic("success");
        const vurl = URL.createObjectURL(result.blob);
        const vfile = new File([result.blob], `cavi-music-${s.id}.${result.ext}`, { type: result.blob.type });
        preview.replaceChildren(h("video", { src: vurl, autoplay: true, muted: true, loop: true, playsinline: true, controls: true }));
        const actions = [];
        if (canShareFiles(vfile)) actions.push(sheetItem("share", t("share.shareVideo"), () => shareFile(vfile, s, link), "accent"));
        if (!tg) actions.push(sheetItem("download", t("share.saveVideo"), () => saveFile(vurl, `${base}.${result.ext}`)));
        actions.push(h("p", { class: "story-note" }, t("share.igNote")));
        videoItem.replaceWith(...actions);
      }, "accent");
      items.append(videoItem);
    }
    if (canShareFiles(file)) {
      items.append(sheetItem("share", t("share.story"), () => shareFile(file, s, link)));
    }
    if (tgStoriesSupported()) {
      items.append(sheetItem("send", t("share.tgStory"), () => {
        const premium = !!tg.initDataUnsafe?.user?.is_premium;
        const limit = premium ? 2048 : 200;
        const tail = `🎵 ${s.artist} — ${s.title}\n${link}`;
        const words = lines.length ? lines.map((l) => l.text).join("\n") + "\n" : "";
        const params = { text: ((words.length + tail.length <= limit ? words : "") + tail).slice(0, limit) };
        if (premium) params.widget_link = { url: link, name: CONFIG.appName };
        try { tg.shareToStory(abs(s.story || coverUrl(s)), params); } catch (e) { toast(String(e.message || e)); }
      }));
    }
    if (!tg) {
      items.append(sheetItem("download", t("share.save"), () => saveFile(url, `${base}.jpg`)));
    } else if (!canShareFiles(file)) {
      // Telegram's in-app browser can't hand files to Instagram; the phone's browser can.
      items.append(sheetItem("share", t("share.openBrowser"), () => { dismiss(); tg.openLink(link); }));
    }
    items.append(sheetItem("copy", at ? t("share.linkAt", { t: fmtTime(at) }) : t("share.link"), () => copy(link)));
    items.append(h("p", { class: "story-note" }, `💡 ${t("share.linkTip")}`));
  });
}

/** The ⤴ button: link, Telegram, story card, lyrics card. */
export function openShare(s, { at = 0, onLyrics } = {}) {
  openSheet((sheet, dismiss) => {
    const act = (fn) => () => { dismiss(); setTimeout(fn, 150); };
    sheet.append(h("div", { class: "sheet-head" }, h("div", null, h("b", null, t("share.title")), h("span", null, `${s.artist} — ${s.title}`))));
    sheet.append(sheetItem("share", t("share.card"), act(() => openStory(s, [], at)), "accent"));
    if (s.lyrics && onLyrics) sheet.append(sheetItem("mic", t("share.lyricsCard"), act(onLyrics)));
    sheet.append(sheetItem("send", t("share.telegram"), act(() => {
      const url = `https://t.me/share/url?url=${encodeURIComponent(songLink(s, at))}&text=${encodeURIComponent(`🎵 ${s.artist} — ${s.title}`)}`;
      if (tg) tg.openTelegramLink(url); else window.open(url, "_blank", "noopener");
    })));
    sheet.append(sheetItem("copy", t("share.link"), act(() => copy(songLink(s)))));
    if (at >= 1) sheet.append(sheetItem("clock", t("share.linkAt", { t: fmtTime(at) }), act(() => copy(songLink(s, at)))));
  });
}
