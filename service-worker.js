/* =========================================================================
   ADD-ON: Service Worker — caches the app shell so the app opens and
   works fully offline once installed (needed for a good TWA/Android
   wrapper experience, and for "Add to Home Screen").

   IMPORTANT: bump CACHE_NAME (e.g. "v2", "v3"...) every time you deploy
   new app files, otherwise returning visitors/installed-app users may
   keep seeing the old cached version. This file does not touch Firebase
   traffic at all — Firestore/Auth requests always go straight to the
   network so Sync Now / login always uses live data.
   ========================================================================= */
const CACHE_NAME = "substitute-tt-shell-v2";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./storage.js",
  "./script.js",
  "./firebase-config.js",
  "./sync.js",
  "./gate.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle our own same-origin GET requests. Everything else
  // (Firebase/Firestore/Auth calls to googleapis.com / gstatic.com,
  // POST requests, etc.) goes straight to the network, untouched.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached); // offline -> fall back to cache
      return cached || network;
    })
  );
});
