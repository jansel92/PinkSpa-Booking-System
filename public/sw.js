const CACHE_NAME = "pinkspa-cache-v24";
const urlsToCache = [
  "/",
  "/index.html",
  "/style.css",
  "/client.js",
  "/manifest.json",
  "/images/favicon.png",
  "/images/PinkSpa.png",
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
