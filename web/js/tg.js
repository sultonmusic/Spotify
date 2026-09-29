// Telegram Mini App integration (safe no-ops in a normal browser).
const W = window.Telegram?.WebApp;
export const tg = W && W.initData ? W : null;
export const inTelegram = !!tg;

const atLeast = (v) => !!tg && typeof tg.isVersionAtLeast === "function" && tg.isVersionAtLeast(v);

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    if (atLeast("6.1")) { tg.setHeaderColor("#121212"); tg.setBackgroundColor("#000000"); }
    if (atLeast("7.10")) tg.setBottomBarColor?.("#000000");
    if (atLeast("7.7")) tg.disableVerticalSwipes?.();
  } catch (e) { console.warn(e); }
}

/** Ask before closing the mini app while music is playing (closing stops the music). */
export function setClosingGuard(on) {
  if (!tg || !atLeast("6.2")) return;
  try { on ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation(); } catch { /* ignore */ }
}

export function user() {
  return tg?.initDataUnsafe?.user || null;
}

export function startParam() {
  return tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get("tgWebAppStartParam") || "";
}

let backHandler = null;
export function setBackButton(visible, handler) {
  if (!tg || !atLeast("6.1")) return;
  if (backHandler) tg.BackButton.offClick(backHandler);
  backHandler = null;
  if (visible) {
    backHandler = handler;
    tg.BackButton.onClick(backHandler);
    tg.BackButton.show();
  } else tg.BackButton.hide();
}

export function haptic(kind = "light") {
  if (!tg || !atLeast("6.1")) return;
  try {
    if (kind === "success" || kind === "error" || kind === "warning") tg.HapticFeedback.notificationOccurred(kind);
    else if (kind === "select") tg.HapticFeedback.selectionChanged();
    else tg.HapticFeedback.impactOccurred(kind);
  } catch { /* ignore */ }
}

export function openLink(url) {
  if (tg) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}

export function shareLink(url, text) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg) { tg.openTelegramLink(share); return true; }
  if (navigator.share) { navigator.share({ title: text, url }).catch(() => {}); return true; }
  return false;
}

export function canDownload() {
  return !tg || atLeast("8.0");
}

export function download(url, fileName) {
  if (tg && atLeast("8.0")) {
    try { tg.downloadFile({ url, file_name: fileName }); return; } catch { /* fall through */ }
  }
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

// ---- CloudStorage (per-user storage synced across the user's Telegram devices)
export const cloudAvailable = () => atLeast("6.9") && !!tg?.CloudStorage;

function cs(method, ...args) {
  return new Promise((resolve, reject) => {
    try {
      tg.CloudStorage[method](...args, (err, res) => (err ? reject(err) : resolve(res)));
    } catch (e) { reject(e); }
  });
}

export const cloud = {
  keys: () => cs("getKeys"),
  getMany: (keys) => (keys.length ? cs("getItems", keys) : Promise.resolve({})),
  set: (key, value) => cs("setItem", key, value),
  remove: (keys) => (keys.length ? cs("removeItems", keys) : Promise.resolve(true)),
};
