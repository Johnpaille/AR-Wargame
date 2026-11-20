// Offline support: once loaded over USB, the phone can start the app without the PC.
// App files: network first (dev edits still arrive), cache as fallback. three.js CDN: cache first.
const CACHE = 'wargame-ar-v1';
const SHELL = ['./', 'index.html', 'app.js', 'rules.js', 'manifest.webmanifest', 'icon.svg',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // never cache the multiplayer relay or non-GET requests
  if (e.request.method !== 'GET' || url.pathname === '/events' || url.pathname === '/state') return;
  if (url.origin !== location.origin) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
