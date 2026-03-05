/* Starshine Invoice Pro — PWA Service Worker
   - Works on HTTPS (or http://localhost)
   - Won't run from file:// (that's normal)
*/
const CACHE = "starshine-invoice-pro-pwa-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./renderer.js",
  "./manifest.webmanifest",
  "./assets/pwa-180.png",
  "./assets/pwa-192.png",
  "./assets/pwa-512.png",
  "./assets/pwa-maskable-512.png",
  "./assets/logo.png",
  "./assets/icon.png",
  "./assets/icon-clean.png",
  "./assets/icon.ico"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.addAll(ASSETS);
      } catch (e) {
        // If some optional assets don't exist, don't fail install.
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      // Prefer cached first (fast + offline). Ignore querystring so updates still hit same cache key.
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const resp = await fetch(event.request);
        // Cache successful same-origin responses
        if (resp && resp.status === 200) {
          cache.put(event.request, resp.clone());
        }
        return resp;
      } catch (e) {
        // Offline fallback: app shell
        const shell = await cache.match("./index.html");
        return shell || new Response("Offline", { status: 503 });
      }
    })()
  );
});
