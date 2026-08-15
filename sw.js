/* Service worker — makes the installed game work with no network.

   Two strategies, deliberately:

   - HTML goes NETWORK FIRST, cache second. A game cached hard is a game that
     never updates; players would sit on an old build until they cleared site
     data, and there is no obvious way for them to know. Online, they always
     get the current file. Offline, they get the last one that loaded.
   - Everything else goes CACHE FIRST. Icons and the manifest do not change
     without a version bump, and serving them from disk is instant.

   Bump CACHE_VERSION when the asset list changes; the activate handler then
   deletes every older cache.                                                */

const CACHE_VERSION = 'singularity-v18';

const ASSETS = [
  './',
  './index.html',
  './singularity.html',
  './collision.html',
  './manifest.json',
  './icon-32.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // Individually, so one missing file cannot fail the whole install.
      .then(cache => Promise.all(ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n !== CACHE_VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // leave third parties alone

  const wantsHTML = req.mode === 'navigate' ||
                    (req.headers.get('accept') || '').includes('text/html');

  if (wantsHTML) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./singularity.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
