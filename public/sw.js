const CACHE_NAME = "pinkspa-cache-v81";
const urlsToCache = [
  "/",
  "/index.html",
  "/style.css",
  "/client.js",
  "/manifest.json",
  "/images/pinkspa-mini-mark.png",
  "/images/pinkspa-icon-192.png",
  "/images/pinkspa-icon-512.png",
  "/images/apple-touch-icon.png",
  "/images/pinkspa-favicon-32.png",
  "/images/pinkspa-favicon-64.png",
  "/images/pinkspa-3d-master.png",
  "/images/hero-luxury.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
