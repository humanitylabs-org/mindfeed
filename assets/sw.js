const CACHE = 'mindfeed-v2';
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');

function scoped(path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${SCOPE_PATH}${clean}`;
}

const ASSETS = [scoped('/'), scoped('/cards.json'), scoped('/manifest.json'), scoped('/sw.js')];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
});

self.addEventListener('fetch', e => {
  // Network-first for API calls, cache-first for assets
  if (e.request.url.includes('review-state') || e.request.url.includes('cards.json')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
