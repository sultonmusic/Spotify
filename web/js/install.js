// "Get the app". On Android browsers (not in Telegram, not already in the app) a download of the APK
// (android/, built by .github/workflows/android.yml); elsewhere the browser's own "Install" when it offers one.
import { CONFIG } from "./config.js";
import { inTelegram, haptic } from "./tg.js";
import { h, icon, toast } from "./ui.js";
import { t } from "./i18n.js";

const store = (s) => ({
  get(k) { try { return s().getItem(k); } catch { return null; } },
  set(k, v) { try { s().setItem(k, v); } catch { /* ignore */ } },
});
const session = store(() => sessionStorage);
const local = store(() => localStorage);

// The Android app opens the site with an android-app:// referrer; remember it for the rest of the visit.
if (document.referrer.startsWith("android-app://")) session.set("ms.inApp", "1");
const standalone = () => ["standalone", "fullscreen", "minimal-ui"].some((m) => matchMedia(`(display-mode: ${m})`).matches)
  || navigator.standalone === true;
export const inApp = () => session.get("ms.inApp") === "1" || standalone();
const android = /Android/i.test(navigator.userAgent);

let prompt = null;
const waiting = new Set(); // banners to show once the browser offers "Install"
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  prompt = e;
  for (const fn of waiting) fn();
});
window.addEventListener("appinstalled", () => { prompt = null; });

/** "apk", "pwa" or null. */
export function appOffer() {
  if (inTelegram || inApp()) return null;
  if (android && CONFIG.apkUrl) return "apk";
  return prompt ? "pwa" : null;
}

export async function getApp() {
  const kind = appOffer();
  haptic("light");
  if (kind === "apk") {
    const a = h("a", { href: CONFIG.apkUrl, rel: "noopener" });
    document.body.append(a);
    a.click();
    a.remove();
    toast(t("app.downloading"), 6000);
  } else if (kind === "pwa") {
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
    prompt = null;
  }
}

const HIDE_KEY = "ms.appBannerOff";
const HIDE_DAYS = 14;

/** A card at the top of Home; "×" hides it for two weeks (Settings still has the link). */
export function appBanner() {
  const off = Number(local.get(HIDE_KEY)) || 0;
  const box = h("div", { class: "app-banner", hidden: true });
  if (inTelegram || inApp() || Date.now() - off < HIDE_DAYS * 864e5) return box;
  const fill = () => {
    const kind = appOffer();
    if (!kind) return;
    waiting.delete(fill);
    box.replaceChildren(
      h("img", { src: "icons/icon-192.png", alt: "" }),
      h("div", { class: "app-copy" }, h("b", null, t("app.title")), h("span", null, t(kind === "apk" ? "app.subApk" : "app.subPwa"))),
      h("button", { class: "btn accent", onclick: () => getApp() }, t(kind === "apk" ? "app.download" : "app.install")),
      h("button", { class: "app-close", "aria-label": t("common.close"), html: icon("close", 18),
        onclick: () => { local.set(HIDE_KEY, String(Date.now())); box.remove(); } }));
    box.hidden = false;
  };
  if (appOffer()) fill();
  else { waiting.clear(); waiting.add(fill); } // only the Home on screen
  return box;
}
