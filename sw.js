const CACHE_NAME = 'janelle-writes-shell-v1';
const APP_SHELL = [
  '/offline/',
  '/manifest.webmanifest',
  '/assets/marketing.css',
  '/assets/marketing.js',
  '/assets/pwa-install.js',
  '/assets/pwa/icon-192.png',
  '/assets/pwa/icon-512.png',
  '/assets/pwa/icon-maskable-512.png',
  '/assets/pwa/apple-touch-icon.png'
];
const CACHEABLE_PAGE_PATHS = new Set([
  '/how-it-works/',
  '/for-you/',
  '/features/',
  '/reviews/',
  '/students/',
  '/offline/'
]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isSensitiveRequest(url) {
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return true;
  if (url.search) return true;
  return false;
}

async function networkFirstPage(request, url) {
  try {
    const response = await fetch(request);
    if (response.ok && CACHEABLE_PAGE_PATHS.has(url.pathname)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (CACHEABLE_PAGE_PATHS.has(url.pathname)) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
    }
    return (await caches.match('/offline/')) || Response.error();
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isSensitiveRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request, url));
    return;
  }

  if (
    url.pathname.startsWith('/assets/pwa/') ||
    url.pathname === '/assets/marketing.css' ||
    url.pathname === '/assets/marketing.js' ||
    url.pathname === '/assets/pwa-install.js' ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(cacheFirstAsset(request));
  }
});
