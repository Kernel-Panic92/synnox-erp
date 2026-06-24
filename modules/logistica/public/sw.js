const CACHE = 'tiles-v1';
const TILE_DOMAINS = ['tile.openstreetmap.org', '*.basemaps.cartocdn.com', 'server.arcgisonline.com'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isTile = TILE_DOMAINS.some(d => url.hostname === d || url.hostname.endsWith(d.replace('*.', '.')));
  if (!isTile) return;
  const accept = e.request.headers.get('Accept') || '';
  if (!accept.includes('image')) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      if (cached) return cached;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })
  );
});
