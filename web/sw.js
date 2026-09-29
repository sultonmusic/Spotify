// Service worker: app shell works offline, covers are cached, audio is streamed directly.
const VERSION = "__BUILD__";
const SHELL = `shell-${VERSION}`;
const IMAGES = "images-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["./", "index.html", "manifest.webmanifest", "icons/icon-192.png"]).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("shell-") && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (/\/library\/audio\//.test(url.pathname) || /\.(mp3|m4a|ogg|wav|flac)$/i.test(url.pathname)) return;

  // Cover art & artist images: cache first.
  if (/\/library\/(covers|artists)\//.test(url.pathname)) {
    e.respondWith(caches.open(IMAGES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Everything else (html, js, css, songs.json, lyrics): network first, cache as fallback.
  // Query strings (cache busters) are dropped from the cache key so the cache doesn't grow.
  const key = url.origin + url.pathname;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const c = await caches.open(SHELL);
        c.put(key, res.clone());
      }
      return res;
    } catch {
      const hit = await caches.match(key);
      if (hit) return hit;
      if (req.mode === "navigate") return caches.match("index.html");
      throw new Error("offline");
    }
  })());
});
