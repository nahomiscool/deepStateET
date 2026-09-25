// Offline support: the app shell is cached, and map data falls back to the last copy
// seen when the network is unavailable. Bump VERSION when shell files change.
const VERSION = 'v2';
const SHELL = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/i18n.js', 'js/geo.js', 'js/events.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/togeojson.umd.js', 'vendor/jszip.min.js',
  'img/icon.svg', 'img/icon-192.png', 'manifest.webmanifest',
  'data/config.json', 'data/regions.geojson', 'data/towns.geojson', 'data/roads.geojson'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network first, so people always get the newest map when online.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
