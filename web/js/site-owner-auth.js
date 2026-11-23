import { CONFIG } from "./config.js";

const OWNER_TOKEN_KEY = "cavi.site-owner-token";

export function siteOwnerToken() {
  try {
    const token = localStorage.getItem(OWNER_TOKEN_KEY) || "";
    const expires = Number(token.split(".")[1]) * 1000;
    if (!token || !Number.isFinite(expires) || expires <= Date.now()) {
      localStorage.removeItem(OWNER_TOKEN_KEY);
      return "";
    }
    return token;
  } catch { return ""; }
}

export function siteOwnerHeaders() {
  const token = siteOwnerToken();
  return token ? { "X-Cavi-Owner-Token": token } : {};
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${CONFIG.statsUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...siteOwnerHeaders(), ...(options.headers || {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Music service returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export function createSiteOwnerConnection(signal) {
  return jsonRequest("/api/owner/connect", { method: "POST", body: "{}", signal });
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Connection cancelled", "AbortError")); };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function waitForSiteOwnerConnection(code, signal) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (signal?.aborted) throw new DOMException("Connection cancelled", "AbortError");
    let body;
    try {
      body = await jsonRequest(`/api/owner/connect/${encodeURIComponent(code)}`);
    } catch (error) {
      if (error.status === 410) throw error;
      await pause(2_000, signal);
      continue;
    }
    if (body.status === "CONNECTED" && body.token) {
      try { localStorage.setItem(OWNER_TOKEN_KEY, body.token); } catch { throw new Error("Enable site storage to keep this connection."); }
      return body.token;
    }
    await pause(2_000, signal);
  }
  throw new Error("Connection timed out. Start again and open the Telegram link.");
}

export function queueRecognizedTrack(track) {
  return jsonRequest("/api/identify/queue", { method: "POST", body: JSON.stringify({ track }) });
}
