// Cavi Music relay — wakes the station up as soon as someone writes to the bot, and keeps ad statistics.
//
// The bot itself runs on GitHub Actions (Shazam, ffmpeg, AI tagging, commit, site deploy), but GitHub starts
// scheduled runs late (sometimes hours apart). This tiny Cloudflare Worker runs every minute for free: when
// messages are waiting in Telegram and the bot isn't already running, it marks them with 👀 and starts the
// GitHub workflow right away. It never processes songs and never consumes the messages (the bot does).

import { DurableObject } from "cloudflare:workers";

const API = "https://api.github.com";

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
  totals(day) {
    const all = this.sql.exec("SELECT ad, ev, COUNT(*) AS n, COUNT(DISTINCT uid) AS people FROM ev GROUP BY ad, ev").toArray();
    const today = this.sql.exec("SELECT ad, ev, COUNT(DISTINCT uid) AS people FROM ev WHERE day = ? GROUP BY ad, ev", day).toArray();
    return { all, today };
  }
}

const EVENTS = new Set(["view", "iview", "skip", "complete", "click"]);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const stats = (env) => env.ADSTATS.get(env.ADSTATS.idFromName("all"));

async function sha256(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
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
