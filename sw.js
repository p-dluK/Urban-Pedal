const CACHE = 'altitude-bike-v6';
const CORE = [
  './', './index.html', './style.css', './app.js', './topo-layer.js',
  './manifest.webmanifest', './icon.png', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // A falha de um ícone não deve impedir a instalação do app.
    await Promise.all(CORE.map(async path => {
      try {
        const response = await fetch(new Request(path, { cache: 'no-store' }));
        if (response.ok) await cache.put(path, response);
      } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(key => key.startsWith('altitude-bike-') && key !== CACHE)
          .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Nunca intercepta APIs externas, tiles ou geocodificação.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cacheKey = new Request(url.pathname + url.search, { method: 'GET' });

    try {
      // Ignora o cache HTTP do navegador para obter a publicação atual do GitHub Pages.
      const fresh = await fetch(new Request(request, { cache: 'no-store' }));
      if (fresh && fresh.ok) {
        await cache.put(cacheKey, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (error) {
      const cached = await cache.match(cacheKey) || await cache.match(url.pathname);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        return (await cache.match('./index.html')) || Response.error();
      }
      return Response.error();
    }
  })());
});
