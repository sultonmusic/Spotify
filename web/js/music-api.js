// Website-to-station upload API. Telegram initData or a paired owner session authenticates writes.
import { CONFIG } from "./config.js";
import { inTelegram, tg } from "./tg.js";
import { siteOwnerHeaders } from "./site-owner-auth.js";

const MAX_BYTES = 20 * 1024 * 1024;

async function api(path, options = {}) {
  const telegramHeaders = inTelegram && tg?.initData ? { "X-Telegram-Init-Data": tg.initData } : {};
  const ownerHeaders = siteOwnerHeaders();
  if (!Object.keys(telegramHeaders).length && !Object.keys(ownerHeaders).length) {
    throw new Error("Connect this device to the owner Telegram account first.");
  }
  const response = await fetch(`${CONFIG.statsUrl}${path}`, {
    ...options,
    headers: { ...telegramHeaders, ...ownerHeaders, ...(options.headers || {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Music service returned HTTP ${response.status}`);
  return body;
}

export function uploadStationMedia(file, onProgress = () => {}) {
  if (!file || file.size < 1 || file.size > MAX_BYTES) throw new Error("Choose a file up to 20 MB.");
  const form = new FormData();
  form.append("file", file, file.name);
  const telegramHeaders = inTelegram && tg?.initData ? { "X-Telegram-Init-Data": tg.initData } : {};
  const ownerHeaders = siteOwnerHeaders();
  if (!Object.keys(telegramHeaders).length && !Object.keys(ownerHeaders).length) {
    return Promise.reject(new Error("Connect this device to the owner Telegram account first."));
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${CONFIG.statsUrl}/api/music/upload`);
    xhr.timeout = 120_000;
    for (const [name, value] of Object.entries({ ...telegramHeaders, ...ownerHeaders })) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100))); };
    xhr.onerror = () => reject(new Error("Network error while uploading the file."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Check your connection and try again."));
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || "{}"); } catch { /* use the HTTP message below */ }
      if (xhr.status < 200 || xhr.status >= 300) reject(new Error(body.error || `Music service returned HTTP ${xhr.status}`));
      else resolve(body);
    };
    xhr.send(form);
  });
}

export function getStationJob(id) {
  return api(`/api/music/jobs/${encodeURIComponent(id)}`);
}

export async function searchStationMusic(query) {
  const response = await fetch(`${CONFIG.statsUrl}/api/music/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Music search returned HTTP ${response.status}`);
  return body.songs || [];
}
