// Sharing: links that start at a moment of the song, and 9:16 story cards
// (cover + chosen lyric lines) for Instagram / Telegram / WhatsApp stories.
import { h, icon, toast, openSheet, sheetItem, siteUrl, fmtTime } from "./ui.js";
import { coverUrl, lib } from "./store.js";
import { t, LANG } from "./i18n.js";
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

/** Draws the story card. lines: [{text, tr}] (0–4 lyric lines). Returns a JPEG blob. */
export async function renderStory(s, lines = []) {
  try { await document.fonts?.ready; } catch { /* ignore */ }
  const W = 1080, H = 1920;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const color = s.color || "#3a3a3a";
  const [img, logo] = await Promise.all([loadImage(coverUrl(s)), loadImage("icons/icon-192.png")]);

  // background: song colour + blurred cover
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

  const cardX = 90, cardW = W - 180, pad = 64;
  const artists = (s.artists || [s.artist]).join(", ");
  if (lines.length) {
    // Lyrics card (song colour), header with cover + title, then the chosen lines
    ctx.font = `800 64px ${FONT}`;
    const blocks = lines.map((l) => {
      ctx.font = `800 64px ${FONT}`;
      const main = wrap(ctx, l.text, cardW - pad * 2);
      ctx.font = `500 38px ${FONT}`;
      const tr = l.tr ? wrap(ctx, l.tr, cardW - pad * 2) : [];
      return { main, tr };
    });
    const bodyH = blocks.reduce((a, b) => a + b.main.length * 78 + b.tr.length * 48 + 30, 0);
    const cardH = pad + 150 + 50 + bodyH + pad - 30;
    const cardY = Math.max(150, (H - cardH) / 2 - 60);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 60; ctx.shadowOffsetY = 20;
    roundRect(ctx, cardX, cardY, cardW, cardH, 48);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
    if (img) {
      ctx.save(); roundRect(ctx, cardX + pad, cardY + pad, 150, 150, 16); ctx.clip();
      coverFit(ctx, img, cardX + pad, cardY + pad, 150); ctx.restore();
    }
    ctx.fillStyle = "#fff"; ctx.textBaseline = "top";
    ctx.font = `800 46px ${FONT}`;
    ctx.fillText(wrap(ctx, s.title, cardW - pad * 2 - 180)[0] || "", cardX + pad + 180, cardY + pad + 30);
    ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.font = `500 36px ${FONT}`;
    ctx.fillText(wrap(ctx, artists, cardW - pad * 2 - 180)[0] || "", cardX + pad + 180, cardY + pad + 90);
    let y = cardY + pad + 150 + 50;
    for (const b of blocks) {
      ctx.fillStyle = "#fff"; ctx.font = `800 64px ${FONT}`;
      for (const line of b.main) { ctx.fillText(line, cardX + pad, y); y += 78; }
      ctx.fillStyle = "rgba(255,255,255,.72)"; ctx.font = `500 38px ${FONT}`;
      for (const line of b.tr) { ctx.fillText(line, cardX + pad, y); y += 48; }
      y += 30;
    }
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
  }

  // footer: platform mark
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

  return new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.92));
}

function canShareFiles(file) {
  try { return !!navigator.canShare && navigator.canShare({ files: [file] }); } catch { return false; }
}

const tgStoriesSupported = () => !!tg && typeof tg.shareToStory === "function" && tg.isVersionAtLeast?.("7.8");

function copy(text) {
  (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast(t("toast.copied")), () => toast(text, 5000));
}

/** Story preview + every way to share it. lines: [{text, tr, at}] */
export async function openStory(s, lines = []) {
  toast(t("share.making"), 1500);
  const blob = await renderStory(s, lines);
  if (!blob) return;
  const at = lines[0]?.at || 0;
  const file = new File([blob], `cavi-music-${s.id}.jpg`, { type: "image/jpeg" });
  const url = URL.createObjectURL(blob);
  openSheet((sheet, dismiss) => {
    sheet.append(h("div", { class: "story-preview" }, h("img", { src: url, alt: "" })));
    if (canShareFiles(file)) {
      sheet.append(sheetItem("share", t("share.story"), async () => {
        haptic("medium");
        try { await navigator.share({ files: [file], title: `${s.artist} — ${s.title}` }); } catch { /* cancelled */ }
      }, "accent"));
    }
    if (tgStoriesSupported()) {
      sheet.append(sheetItem("send", t("share.tgStory"), () => {
        const premium = !!tg.initDataUnsafe?.user?.is_premium;
        const text = (lines.length ? lines.map((l) => l.text).join("\n") + "\n" : "") + `🎵 ${s.artist} — ${s.title}`;
        const params = { text: text.slice(0, premium ? 2048 : 200) };
        if (premium) params.widget_link = { url: songLink(s, at), name: CONFIG.appName };
        try { tg.shareToStory(abs(s.story || coverUrl(s)), params); } catch (e) { toast(String(e.message || e)); }
      }));
    }
    if (!tg) {
      sheet.append(sheetItem("download", t("share.save"), () => {
        const a = h("a", { href: url, download: `${s.artist} - ${s.title}.jpg` });
        document.body.append(a); a.click(); a.remove();
      }));
    } else if (!canShareFiles(file)) {
      // Telegram's in-app browser can't hand images to Instagram; the phone's browser can.
      sheet.append(sheetItem("share", t("share.openBrowser"), () => { dismiss(); tg.openLink(songLink(s, at)); }));
    }
    sheet.append(sheetItem("copy", at ? t("share.linkAt", { t: fmtTime(at) }) : t("share.link"), () => copy(songLink(s, at))));
  });
}

/** The ⤴ button: link, Telegram, story card, lyrics card. */
export function openShare(s, { at = 0, onLyrics } = {}) {
  openSheet((sheet, dismiss) => {
    const act = (fn) => () => { dismiss(); setTimeout(fn, 150); };
    sheet.append(h("div", { class: "sheet-head" }, h("div", null, h("b", null, t("share.title")), h("span", null, `${s.artist} — ${s.title}`))));
    sheet.append(sheetItem("share", t("share.card"), act(() => openStory(s)), "accent"));
    if (s.lyrics && onLyrics) sheet.append(sheetItem("mic", t("share.lyricsCard"), act(onLyrics)));
    sheet.append(sheetItem("send", t("share.telegram"), act(() => {
      const link = `https://t.me/share/url?url=${encodeURIComponent(songLink(s, at))}&text=${encodeURIComponent(`🎵 ${s.artist} — ${s.title}`)}`;
      if (tg) tg.openTelegramLink(link); else window.open(link, "_blank", "noopener");
    })));
    sheet.append(sheetItem("copy", t("share.link"), act(() => copy(songLink(s)))));
    if (at >= 1) sheet.append(sheetItem("clock", t("share.linkAt", { t: fmtTime(at) }), act(() => copy(songLink(s, at)))));
  });
}

export { lib, LANG };
