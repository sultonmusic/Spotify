// Cavi Music relay — wakes the station up as soon as someone writes to the bot, and keeps ad statistics.
//
// The bot itself runs on GitHub Actions (Shazam, ffmpeg, AI tagging, commit, site deploy), but GitHub starts
// scheduled runs late (sometimes hours apart). This tiny Cloudflare Worker runs every minute for free: when
// messages are waiting in Telegram and the bot isn't already running, it marks them with 👀 and starts the
// GitHub workflow right away. It never processes songs and never consumes the messages (the bot does).

import { DurableObject } from "cloudflare:workers";

const API = "https://api.github.com";
const MUSIC_SITE_ORIGIN = "https://sultonmusic.github.io";
const MUSIC_MAX_BYTES = 20 * 1024 * 1024;
const MUSIC_CHUNK_BYTES = 3 * 1024 * 1024;
let stationAdminCache = { at: 0, ids: null };
let stationLibraryCache = { at: 0, songs: null };

async function github(env, path, init = {}) {
  return fetch(`${API}/repos/${env.REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cavi-music-relay",
      ...(init.headers || {}),
    },
  });
}

async function telegram(env, method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function encodeJsonHeader(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeJsonHeader(value) {
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0))));
}

async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)));
}

async function verifyMiniApp(request, env, maxAge = 86_400) {
  const origin = request.headers.get("Origin");
  if (origin !== MUSIC_SITE_ORIGIN) return null;
  const raw = request.headers.get("X-Telegram-Init-Data") || "";
  if (!raw || raw.length > 16_384) return null;
  const params = new URLSearchParams(raw);
  const received = params.get("hash") || "";
  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!/^[a-f0-9]{64}$/i.test(received) || !Number.isInteger(authDate) || authDate > now + 60 || now - authDate > maxAge) return null;
  const data = [...params.entries()].filter(([key]) => key !== "hash").sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), env.TELEGRAM_BOT_TOKEN);
  const expected = hex(await hmac(secret, data));
  let diff = expected.length ^ received.length;
  for (let i = 0; i < Math.min(expected.length, received.length); i++) diff |= expected.charCodeAt(i) ^ received.toLowerCase().charCodeAt(i);
  if (diff) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user || !Number.isSafeInteger(user.id) || user.is_bot) return null;
    return { uid: String(user.id), authDate };
  } catch { return null; }
}

async function stationAdmins(env) {
  if (stationAdminCache.ids && Date.now() - stationAdminCache.at < 60_000) return stationAdminCache.ids;
  const site = (env.SITE_URL || "https://sultonmusic.github.io/Spotify/").replace(/\/?$/, "/");
  const response = await fetch(`${site}library/songs.json`, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`station library: HTTP ${response.status}`);
  const data = await response.json();
  const ids = Array.isArray(data?.site?.admins) ? data.site.admins : [];
  stationAdminCache = { at: Date.now(), ids };
  return ids;
}

async function isStationAdmin(env, uid) {
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(uid), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode("cavi-music:admin"), iterations: 150_000 }, key, 256);
    const digest = hex(bits);
    return (await stationAdmins(env)).some((item) => typeof item === "string" && item.length === digest.length &&
      [...digest].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ item[i].charCodeAt(0)), 0) === 0);
  } catch { return false; }
}

async function requireStationOwner(request, env, maxAge) {
  const identity = await verifyMiniApp(request, env, maxAge);
  return identity && await isStationAdmin(env, identity.uid) ? identity : null;
}

function musicCors(request) {
  const origin = request.headers.get("Origin");
  if (origin !== MUSIC_SITE_ORIGIN) return {};
  return { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data", "Cache-Control": "no-store" };
}

function musicJson(request, body, status = 200) {
  return Response.json(body, { status, headers: musicCors(request) });
}

function webMusicDO(env, id) {
  return env.WEBMUSIC.get(env.WEBMUSIC.idFromName("music-jobs"));
}

async function jobSignatureOK(request, env, action, id) {
  const timestamp = request.headers.get("X-Music-Timestamp") || "";
  const signature = request.headers.get("X-Music-Signature") || "";
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = hex(await hmac(new TextEncoder().encode(env.DISPATCH_TOKEN), `cavi-web-music\n${action}\n${id}\n${timestamp}`));
  let diff = expected.length ^ signature.length;
  for (let i = 0; i < Math.min(expected.length, signature.length); i++) diff |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  return diff === 0;
}

const AUDIO_TYPES = new Set([".mp3", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wav", ".wma", ".aif", ".aiff", ".ape", ".alac", ".amr", ".mka", ".weba"]);
const VIDEO_TYPES = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".3gp", ".m4v"]);

function validateUpload(file) {
  const name = String(file.name || "upload").split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, "").slice(0, 160);
  const ext = (name.match(/\.[a-z0-9]{1,8}$/i) || [""])[0].toLowerCase();
  const mime = String(file.type || "application/octet-stream").toLowerCase().slice(0, 100);
  const kind = VIDEO_TYPES.has(ext) ? "video" : AUDIO_TYPES.has(ext) ? "audio" : "";
  if (!kind || (kind === "audio" && !mime.startsWith("audio/") && mime !== "application/octet-stream") ||
      (kind === "video" && !mime.startsWith("video/") && mime !== "application/octet-stream")) return null;
  return { name, ext, mime, kind };
}

async function createMusicUpload(request, env) {
  const headers = musicCors(request);
  if (!headers["Access-Control-Allow-Origin"]) return musicJson(request, { error: "origin not allowed" }, 403);
  const identity = await requireStationOwner(request, env, 3600);
  if (!identity) return musicJson(request, { error: "owner authorization required; open the site from the Telegram bot" }, 403);
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MUSIC_MAX_BYTES + 256 * 1024) return musicJson(request, { error: "file exceeds 20 MB" }, 413);
  let form;
  try { form = await request.formData(); } catch { return musicJson(request, { error: "invalid upload" }, 400); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return musicJson(request, { error: "choose an audio or video file" }, 400);
  if (!file.size || file.size > MUSIC_MAX_BYTES) return musicJson(request, { error: "file must be between 1 byte and 20 MB" }, 413);
  const details = validateUpload(file);
  if (!details) return musicJson(request, { error: "unsupported audio/video file type" }, 415);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > MUSIC_MAX_BYTES) return musicJson(request, { error: "upload size mismatch" }, 400);
  const fileKey = hex(await crypto.subtle.digest("SHA-256", bytes));
  const id = crypto.randomUUID();
  const meta = { id, uid: identity.uid, fileName: details.name, mime: details.mime, kind: details.kind,
    size: bytes.byteLength, fileKey, createdAt: Date.now() };
  const stub = webMusicDO(env, id);
  const saved = await stub.fetch("https://music-jobs/create", { method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Music-Meta": encodeJsonHeader(meta) }, body: bytes });
  if (!saved.ok) return musicJson(request, await saved.json().catch(() => ({ error: "could not queue upload" })), saved.status);
  const dispatch = await github(env, "/actions/workflows/web-music.yml/dispatches", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: env.BRANCH, inputs: { job_id: id } }) });
  if (!dispatch.ok) {
    await stub.fetch(`https://music-jobs/status/${id}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: identity.uid, status: "FAILED", message: "Could not start the processor. Try again later." }) });
    return musicJson(request, { error: "could not start music processing" }, 503);
  }
  return musicJson(request, { ...(await saved.json()), status: "QUEUED" }, 202);
}

async function publicMusicJob(request, env, id) {
  if (!(await requireStationOwner(request, env))) return musicJson(request, { error: "owner authorization required" }, 403);
  const identity = await verifyMiniApp(request, env);
  const response = await webMusicDO(env, id).fetch(`https://music-jobs/job/${id}`, { headers: { "X-Music-Uid": identity.uid } });
  return new Response(response.body, { status: response.status, headers: { ...musicCors(request), "Content-Type": "application/json" } });
}

async function internalMusic(request, env, url) {
  const match = url.pathname.match(/^\/internal\/music\/jobs\/([a-f0-9-]{36})\/(input|status)$/i);
  if (!match) return new Response("not found", { status: 404 });
  const [, id, action] = match;
  if (!(await jobSignatureOK(request, env, action, id))) return new Response("forbidden", { status: 403 });
  const stub = webMusicDO(env, id);
  if (action === "input" && request.method === "GET") return stub.fetch(`https://music-jobs/input/${id}`);
  if (action === "status" && request.method === "POST") return stub.fetch(`https://music-jobs/status/${id}`, { method: "POST", body: request.body, headers: { "Content-Type": "application/json" } });
  return new Response("method not allowed", { status: 405 });
}

/** Is a run of the station workflow queued or running? (Then it will read the messages itself.) */
async function stationBusy(env) {
  const res = await github(env, `/actions/workflows/${env.WORKFLOW}/runs?per_page=5`);
  if (!res.ok) throw new Error(`GitHub runs: HTTP ${res.status}`);
  const { workflow_runs: runs = [] } = await res.json();
  return runs.some((r) => r.status !== "completed");
}

export async function check(env) {
  // Never call getUpdates while the bot is polling: Telegram allows only one reader at a time.
  if (await stationBusy(env)) return "busy";
  const res = await telegram(env, "getUpdates", { timeout: 0, limit: 20, allowed_updates: ["message", "callback_query"] });
  if (!res.ok) return `telegram: ${res.description}`;
  const updates = res.result || [];
  if (!updates.length) return "idle";
  // "Received" mark on each waiting message (the reply comes a minute or two later).
  for (const u of updates) {
    const m = u.message;
    if (m?.chat?.id && m.message_id) {
      await telegram(env, "setMessageReaction", { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: "emoji", emoji: "👀" }] });
    }
  }
  const run = await github(env, `/actions/workflows/${env.WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: env.BRANCH }),
  });
  if (run.ok) return `started the station for ${updates.length} message(s)`;
  // Don't fail silently (a read-only key once did, for a whole night): say so in the chat, at most hourly.
  const chat = updates.find((u) => u.message?.chat?.id)?.message.chat.id;
  if (chat && await stats(env).claimAlert(60)) {
    await telegram(env, "sendMessage", { chat_id: chat,
      text: `⚠️ Stansiyani ishga tushira olmadim (GitHub: HTTP ${run.status}). Xabaringiz saqlanib turibdi, muammo tuzatilgach bot uni o'qiydi.` });
  }
  return `GitHub dispatch: HTTP ${run.status}`;
}

// ------------------------------------------------------------------ ad statistics
// The site reports ad views/skips/clicks here (one row per ad, day, event and anonymous listener, so
// reloading a page doesn't inflate the numbers); the bot's /ads command reads the totals.
export class AdStats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS ev (ad TEXT, day TEXT, ev TEXT, uid TEXT, PRIMARY KEY (ad, day, ev, uid))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS log (ts TEXT, msg TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS identify_rate (ip TEXT PRIMARY KEY, bucket INTEGER, hits INTEGER)");
  }
  /** What the last cron tick did; anything other than idle/busy is also kept in a short history. */
  /** True at most once per `minutes`: the relay tells the owner about a problem, but doesn't nag. */
  claimAlert(minutes) {
    const last = this.sql.exec("SELECT v FROM meta WHERE k = 'lastAlert'").toArray()[0];
    if (last && Date.now() - Date.parse(last.v) < minutes * 60_000) return false;
    this.sql.exec("INSERT OR REPLACE INTO meta VALUES ('lastAlert', ?)", new Date().toISOString());
    return true;
  }
  tick(msg) {
    const now = new Date().toISOString();
    this.sql.exec("INSERT OR REPLACE INTO meta VALUES ('lastTick', ?)", `${now} ${msg}`);
    if (msg === "idle" || msg === "busy") return;
    this.sql.exec("INSERT INTO log VALUES (?, ?)", now, msg);
    this.sql.exec("DELETE FROM log WHERE rowid NOT IN (SELECT rowid FROM log ORDER BY rowid DESC LIMIT 100)");
  }
  history() {
    const last = this.sql.exec("SELECT v FROM meta WHERE k = 'lastTick'").toArray()[0];
    return { lastTick: last?.v || null, log: this.sql.exec("SELECT ts, msg FROM log ORDER BY rowid DESC LIMIT 30").toArray() };
  }
  record(ad, day, ev, uid) {
    this.sql.exec("INSERT OR IGNORE INTO ev VALUES (?, ?, ?, ?)", ad, day, ev, uid);
  }
  claimIdentify(ip) {
    const bucket = Math.floor(Date.now() / 60_000);
    const row = this.sql.exec("SELECT bucket, hits FROM identify_rate WHERE ip = ?", ip).toArray()[0];
    if (row?.bucket === bucket && row.hits >= 6) return false;
    this.sql.exec("INSERT OR REPLACE INTO identify_rate VALUES (?, ?, ?)", ip, bucket, row?.bucket === bucket ? row.hits + 1 : 1);
    this.sql.exec("DELETE FROM identify_rate WHERE bucket < ?", bucket - 10);
    return true;
  }
  totals(day) {
    const all = this.sql.exec("SELECT ad, ev, COUNT(*) AS n, COUNT(DISTINCT uid) AS people FROM ev GROUP BY ad, ev").toArray();
    const today = this.sql.exec("SELECT ad, ev, COUNT(DISTINCT uid) AS people FROM ev WHERE day = ? GROUP BY ad, ev", day).toArray();
    return { all, today };
  }
}

// Private, owner-only upload queue. Files are split into 3 MiB rows because SQLite-backed Durable Objects
// cap individual BLOBs at 8 MiB. Raw uploads are removed as soon as the Actions worker finishes.
export class WebMusicJobs extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, uid TEXT NOT NULL, file_name TEXT NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL,
      size INTEGER NOT NULL, file_key TEXT NOT NULL, status TEXT NOT NULL, message TEXT, result TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS jobs_uid_created ON jobs(uid, created_at)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS chunks (job_id TEXT NOT NULL, part INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(job_id, part))");
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/create" && request.method === "POST") {
      let meta;
      try { meta = decodeJsonHeader(request.headers.get("X-Music-Meta") || ""); }
      catch { return Response.json({ error: "invalid upload metadata" }, { status: 400 }); }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!meta.id || !meta.uid || bytes.byteLength !== meta.size || bytes.byteLength > MUSIC_MAX_BYTES) {
        return Response.json({ error: "invalid upload payload" }, { status: 400 });
      }
      const now = Date.now();
      this.sql.exec("DELETE FROM jobs WHERE created_at < ?", now - 7 * 86_400_000);
      this.sql.exec("DELETE FROM chunks WHERE job_id NOT IN (SELECT id FROM jobs)");
      const running = this.sql.exec("SELECT COUNT(*) AS n FROM jobs WHERE uid = ? AND status IN ('QUEUED','PROCESSING','UPLOADING')", meta.uid).toArray()[0]?.n || 0;
      if (running >= 2) return Response.json({ error: "one or two uploads are already processing" }, { status: 429 });
      const recent = this.sql.exec("SELECT COUNT(*) AS n FROM jobs WHERE uid = ? AND created_at > ?", meta.uid, now - 3_600_000).toArray()[0]?.n || 0;
      if (recent >= 6) return Response.json({ error: "upload limit reached; try again in an hour" }, { status: 429 });
      this.sql.exec("INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', 'Waiting for the processor', NULL, ?, ?)",
        meta.id, meta.uid, meta.fileName, meta.mime, meta.kind, meta.size, meta.fileKey, now, now);
      for (let offset = 0, part = 0; offset < bytes.length; offset += MUSIC_CHUNK_BYTES, part++) {
        this.sql.exec("INSERT INTO chunks VALUES (?, ?, ?)", meta.id, part, bytes.slice(offset, offset + MUSIC_CHUNK_BYTES));
      }
      return Response.json({ id: meta.id, status: "QUEUED", createdAt: now }, { status: 202 });
    }

    const jobMatch = url.pathname.match(/^\/job\/([a-f0-9-]{36})$/i);
    if (jobMatch && request.method === "GET") {
      const job = this.sql.exec("SELECT id, uid, file_name, kind, size, status, message, result, created_at, updated_at FROM jobs WHERE id = ?", jobMatch[1]).toArray()[0];
      if (!job) return Response.json({ error: "job not found" }, { status: 404 });
      if (job.uid !== request.headers.get("X-Music-Uid")) return Response.json({ error: "forbidden" }, { status: 403 });
      let result = null;
      try { result = job.result ? JSON.parse(job.result) : null; } catch { /* malformed result stays hidden */ }
      return Response.json({ id: job.id, status: job.status, message: job.message, result,
        fileName: job.file_name, kind: job.kind, size: job.size, createdAt: job.created_at, updatedAt: job.updated_at });
    }

    const inputMatch = url.pathname.match(/^\/input\/([a-f0-9-]{36})$/i);
    if (inputMatch && request.method === "GET") {
      const job = this.sql.exec("SELECT file_name, mime, kind, size, file_key FROM jobs WHERE id = ?", inputMatch[1]).toArray()[0];
      if (!job) return new Response("job not found", { status: 404 });
      const rows = this.sql.exec("SELECT bytes FROM chunks WHERE job_id = ? ORDER BY part", inputMatch[1]).toArray();
      const body = new Uint8Array(job.size);
      let offset = 0;
      for (const row of rows) { const chunk = new Uint8Array(row.bytes); body.set(chunk, offset); offset += chunk.length; }
      if (offset !== job.size) return new Response("upload data expired", { status: 410 });
      const meta = encodeJsonHeader({ fileName: job.file_name, mime: job.mime, kind: job.kind, fileKey: job.file_key });
      return new Response(body, { headers: { "Content-Type": job.mime, "X-Music-Meta": meta, "Cache-Control": "no-store" } });
    }

    const statusMatch = url.pathname.match(/^\/status\/([a-f0-9-]{36})$/i);
    if (statusMatch && request.method === "POST") {
      let update;
      try { update = await request.json(); } catch { return Response.json({ error: "invalid status" }, { status: 400 }); }
      const allowed = new Set(["PROCESSING", "UPLOADING", "COMPLETED", "DUPLICATE", "FAILED"]);
      if (!allowed.has(update.status)) return Response.json({ error: "invalid status" }, { status: 400 });
      const job = this.sql.exec("SELECT id, status FROM jobs WHERE id = ?", statusMatch[1]).toArray()[0];
      if (!job) return Response.json({ error: "job not found" }, { status: 404 });
      let result = null;
      if (update.result && typeof update.result === "object") {
        result = JSON.stringify(update.result);
        if (result.length > 24_000) return Response.json({ error: "result is too large" }, { status: 413 });
      }
      const message = String(update.message || "").slice(0, 240);
      this.sql.exec("UPDATE jobs SET status = ?, message = ?, result = COALESCE(?, result), updated_at = ? WHERE id = ?",
        update.status, message, result, Date.now(), statusMatch[1]);
      if (["COMPLETED", "DUPLICATE", "FAILED"].includes(update.status)) this.sql.exec("DELETE FROM chunks WHERE job_id = ?", statusMatch[1]);
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }
}

const EVENTS = new Set(["view", "iview", "skip", "complete", "click"]);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data" };
const IDENTIFY_ORIGINS = new Set(["https://sultonmusic.github.io"]);
const stats = (env) => env.ADSTATS.get(env.ADSTATS.idFromName("all"));

async function sha256(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function stationSongs(env) {
  if (stationLibraryCache.songs && Date.now() - stationLibraryCache.at < 30_000) return stationLibraryCache.songs;
  const site = (env.SITE_URL || "https://sultonmusic.github.io/Spotify/").replace(/\/?$/, "/");
  const response = await fetch(`${site}library/songs.json`, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`station library: HTTP ${response.status}`);
  const data = await response.json();
  stationLibraryCache = { at: Date.now(), songs: Array.isArray(data.songs) ? data.songs.filter((song) => song?.id && song?.src) : [] };
  return stationLibraryCache.songs;
}

function musicNorm(text) {
  return String(text || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[ʻʼ’'`´]/g, "").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function searchMusic(request, env, url) {
  if (!musicCors(request)["Access-Control-Allow-Origin"]) return musicJson(request, { error: "origin not allowed" }, 403);
  const query = String(url.searchParams.get("q") || "").trim().slice(0, 120);
  if (query.length < 2) return musicJson(request, { error: "enter at least two characters" }, 400);
  let songs;
  try { songs = await stationSongs(env); } catch { return musicJson(request, { error: "music library unavailable" }, 503); }
  const q = musicNorm(query), words = q.split(" ").filter(Boolean);
  const found = [];
  for (const song of songs) {
    const title = musicNorm(song.title), artist = musicNorm(song.artist), album = musicNorm(song.album);
    const all = `${artist} ${title} ${album}`;
    let score = all.includes(q) ? 100 : words.every((word) => all.split(" ").some((part) => part.startsWith(word))) ? 70 : 0;
    if (title === q) score += 30;
    else if (title.startsWith(q)) score += 20;
    if (artist === q || artist.startsWith(q)) score += 12;
    if (score) found.push({ score, song: { id: song.id, title: song.title, artist: song.artist, artists: song.artists,
      album: song.album, duration: song.duration, cover: song.cover, color: song.color, src: song.src,
      mime: song.mime, size: song.size, genre: song.genre, language: song.language, year: song.year,
      moods: song.moods, video: song.video } });
  }
  found.sort((a, b) => b.score - a.score);
  return musicJson(request, { query, count: found.length, songs: found.slice(0, 12).map((item) => item.song) });
}

// ------------------------------------------------------------------ health (no secrets in the answer)
// Answers "why doesn't the station wake up?": can the relay's GitHub key read runs and start the workflow
// (checked with a branch that doesn't exist: 422 = allowed, 403 = no permission, 401 = bad or expired key),
// when does the key expire, is a Telegram webhook blocking getUpdates, how many messages wait, and what
// the last ticks did.
let healthCache = { at: 0, body: null };
async function health(env) {
  if (healthCache.body && Date.now() - healthCache.at < 60_000) return healthCache.body;
  const out = { time: new Date().toISOString() };
  try {
    const read = await github(env, `/actions/workflows/${env.WORKFLOW}/runs?per_page=1`);
    out.githubRead = read.status;
    out.keyExpires = read.headers.get("github-authentication-token-expiration");
    const dry = await github(env, `/actions/workflows/${env.WORKFLOW}/dispatches`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: "relay-health-no-such-ref" }),
    });
    out.githubDispatch = dry.status; // 422 is the healthy answer here
    out.busy = read.ok ? (await read.json()).workflow_runs?.[0]?.status !== "completed" : null;
  } catch (e) { out.githubError = String(e); }
  try {
    const info = (await telegram(env, "getWebhookInfo")).result || {};
    out.telegram = { webhookSet: Boolean(info.url), waitingMessages: info.pending_update_count };
  } catch (e) { out.telegramError = String(e); }
  try { Object.assign(out, await stats(env).history()); } catch (e) { out.historyError = String(e); }
  healthCache = { at: Date.now(), body: out };
  return out;
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === "/api/music/search" && request.method === "GET") return searchMusic(request, env, url);
  if (url.pathname === "/api/music/upload" && request.method === "POST") return createMusicUpload(request, env);
  const musicJob = url.pathname.match(/^\/api\/music\/jobs\/([a-f0-9-]{36})$/i);
  if (musicJob && request.method === "GET") return publicMusicJob(request, env, musicJob[1]);
  if (url.pathname.startsWith("/internal/music/")) return internalMusic(request, env, url);
  if (url.pathname === "/identify" && request.method === "POST") {
    const origin = request.headers.get("Origin") || "";
    const headers = { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Cache-Control": "no-store" };
    const reply = (body, status = 200) => Response.json(body, { status, headers });
    if (!IDENTIFY_ORIGINS.has(origin)) return reply({ error: "origin not allowed" }, 403);
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > 120_000) return reply({ error: "signature too large" }, 413);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 120_000) return reply({ error: "signature too large" }, 413);
      body = JSON.parse(raw);
    } catch { return reply({ error: "bad json" }, 400); }
    const { uri, samplems } = body || {};
    if (typeof uri !== "string" || uri.length > 110_000 ||
        !/^data:audio\/vnd\.shazam\.sig;base64,[A-Za-z0-9+/=]+$/.test(uri) ||
        !Number.isInteger(samplems) || samplems < 1_000 || samplems >= 15_000) {
      return reply({ error: "bad signature" }, 400);
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!await stats(env).claimIdentify(await sha256(`cavi-identify:${ip}`))) {
      return reply({ error: "too many searches; wait a minute and try again" }, 429);
    }
    const now = Date.now();
    const id1 = crypto.randomUUID().toUpperCase();
    const id2 = crypto.randomUUID().toUpperCase();
    const target = `https://amp.shazam.com/discovery/v5/en/US/android/-/tag/${id1}/${id2}` +
      "?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3";
    try {
      const match = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Language": "en_US",
          "User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36",
        },
        body: JSON.stringify({
          geolocation: {},
          signature: { uri, samplems, timestamp: now },
          timestamp: now,
          timezone: request.cf?.timezone || "UTC",
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!match.ok) return reply({ error: "recognition service unavailable" }, 502);
      const result = await match.json();
      return reply({ track: result?.track || null });
    } catch {
      return reply({ error: "recognition service unavailable" }, 502);
    }
  }
  if (url.pathname === "/ad-event" && request.method === "POST") {
    let body;
    try { body = JSON.parse(await request.text()); } catch { return new Response("bad json", { status: 400, headers: CORS }); }
    const { ad, ev, uid } = body || {};
    if (!/^[a-z0-9]{6,16}$/.test(ad || "") || !EVENTS.has(ev) || !/^[a-z0-9]{8,32}$/.test(uid || "")) {
      return new Response("bad event", { status: 400, headers: CORS });
    }
    await stats(env).record(ad, new Date().toISOString().slice(0, 10), ev, uid);
    return new Response(null, { status: 204, headers: CORS });
  }
  if (url.pathname === "/ad-stats") {
    // Only the bot: it proves it knows the bot token without sending it.
    if (request.headers.get("X-Key") !== await sha256(`cavi-stats:${env.TELEGRAM_BOT_TOKEN}`)) {
      return new Response("forbidden", { status: 403 });
    }
    const data = await stats(env).totals(new Date().toISOString().slice(0, 10));
    return Response.json(data);
  }
  if (url.pathname === "/health") return Response.json(await health(env), { headers: CORS });
  return new Response("Cavi Music relay is running.\n", { headers: { "content-type": "text/plain; charset=utf-8", ...CORS } });
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      let result;
      try { result = await check(env); } catch (e) { result = `error: ${String(e)}`; }
      console.log(result);
      try { await stats(env).tick(result); } catch (e) { console.error(String(e)); }
    })());
  },
  fetch: handle,
};
