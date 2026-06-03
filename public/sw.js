const CACHE_NAME = "pinkspa-cache-v1";

const urlsToCache = [
  "/",
  "/index.html",
  "/style.css",
  "/client.js",
  "/manifest.json",
  "/images/PinkSpa.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
