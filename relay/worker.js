// Cavi Music relay — wakes the station up as soon as someone writes to the bot.
//
// The bot itself runs on GitHub Actions (Shazam, ffmpeg, AI tagging, commit, site deploy), but GitHub starts
// scheduled runs late (sometimes hours apart). This tiny Cloudflare Worker runs every minute for free: when
// messages are waiting in Telegram and the bot isn't already running, it marks them with 👀 and starts the
// GitHub workflow right away. It never processes songs and never consumes the messages (the bot does).

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
    body: JSON.stringify({ ref: env.BRANCH }),
  });
  return run.ok ? `started the station for ${updates.length} message(s)` : `GitHub dispatch: HTTP ${run.status}`;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(check(env).then((s) => console.log(s), (e) => console.error(String(e))));
  },
  async fetch() {
    return new Response("Cavi Music relay is running.\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
