// Website-to-station upload API. Uploads are authenticated with Telegram Mini App initData;
// only the station owner can add media to the shared public catalog.
import { CONFIG } from "./config.js";
import { inTelegram, tg } from "./tg.js";

const MAX_BYTES = 20 * 1024 * 1024;

async function api(path, options = {}) {
  if (!inTelegram || !tg?.initData) throw new Error("Open Cavi Music from the Telegram bot to upload media.");
  const response = await fetch(`${CONFIG.statsUrl}${path}`, {
    ...options,
    headers: { "X-Telegram-Init-Data": tg.initData, ...(options.headers || {}) },
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
  if (!inTelegram || !tg?.initData) return Promise.reject(new Error("Open Cavi Music from the Telegram bot to upload media."));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${CONFIG.statsUrl}/api/music/upload`);
    xhr.timeout = 120_000;
    xhr.setRequestHeader("X-Telegram-Init-Data", tg.initData);
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
