// Keeps the app's own files on the phone so it opens with no signal.
// Only same-origin GETs are touched: requests to the spreadsheet script go
// straight to the network, and the app queues sales itself when that fails.
//
// Files are served from the cache and refreshed in the background, so a new
// version of the app shows up the second time it is opened after an update.
const CACHE = 'mv-shell-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/main.js', 'js/calc.js', 'js/summary.js', 'js/store.js', 'js/api.js', 'js/sync.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    const fresh = fetch(request)
      .then((response) => { if (response.ok) cache.put(request, response.clone()); return response; })
      .catch(() => null);
    if (cached) { event.waitUntil(fresh); return cached; }
    return (await fresh) || new Response('Sem conexão.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
