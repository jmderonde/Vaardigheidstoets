// Netwerk eerst, cache als terugval: de app-schil blijft bruikbaar zonder verbinding.
const CACHE = 'vt-shell-v1';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/lib.js', '/js/router.js', '/js/panels.js', '/js/charts.js',
  '/js/views/access.js', '/js/views/setup.js', '/js/views/console.js', '/js/views/observer.js', '/js/views/display.js', '/js/views/report.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
