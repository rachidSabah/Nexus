/**
 * Agent Nexus dashboard service worker (PWA, WS5 Phase 3).
 *
 * SAFETY CONTRACT (do not weaken):
 *  - NEVER intercepts /api/* — that is the proxy to the live gateway. All
 *    routing telemetry, model discovery, and task polling MUST hit the network
 *    so the dashboard shows REAL data, never a stale cache.
 *  - Navigation requests are network-first (so the app always boots fresh).
 *  - Only same-origin static assets (js/css/svg/fonts/images) are cached
 *    cache-first to make the installed app open offline.
 */

const CACHE = 'nexus-dashboard-v1';
const STATIC_RE = /\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?|ttf|ico)$/i;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // never touch cross-origin
  if (url.pathname.startsWith('/api/')) return;           // NEVER cache gateway proxy

  // Static assets: cache-first (offline shell).
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          })
      )
    );
    return;
  }

  // Navigation + everything else: network-first, fall back to cached shell.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req) || caches.match('/'))
  );
});
