const CACHE = 'yourband-v2';

// Núcleo: lo imprescindible para arrancar offline (app shell + fallbacks).
const PRECACHE_CORE = [
  './',
  './index.html',
  './manifest.json',
  './wapps-config.js',
  './wapps-utils.js',
  './wapps-common.css',
  './wapps-store.js',
  './wapps-firebase.js',
  './wapps-nav.js',
  './wapps-onboarding.js',
  './wapps-sync-ui.js',
  './offline.html',
  './404.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

async function precacheAll(cache) {
  const results = await Promise.allSettled(
    PRECACHE_CORE.map(url =>
      cache.add(url).catch(err => {
        console.warn(`[SW] No se pudo cachear ${url}:`, err.message);
      })
    )
  );
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) console.warn(`[SW] ${failed} archivo(s) no cacheados — puede funcionar parcialmente offline`);
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => precacheAll(cache)));
  // No skipWaiting() aquí: se espera confirmación del usuario (ver mensaje SKIP_WAITING).
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // CDNs cacheables: SDK de Firebase, Google Fonts.
  // Cache-first con fallback a red — permite arrancar 100% offline tras la primera visita.
  const isCacheableCDN =
    (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) ||
    (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.includes('/jspdf/')) ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';

  if (isCacheableCDN) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response.ok || response.type === 'opaque') {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(e.request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Dejar pasar sin cachear: Firestore, Auth y demás APIs de Google tienen su propio manejo offline.
  if (
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google.com')
  ) {
    return;
  }

  // STALE-WHILE-REVALIDATE para HTML: sirve la caché al instante y actualiza en segundo plano.
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        const networkFetch = fetch(e.request).then(async response => {
          if (response.ok) {
            const clone = response.clone();
            await cache.put(e.request, clone);
          }
          return response;
        }).catch(() => cached || caches.match('./offline.html'));
        return cached || networkFetch;
      })
    );
    return;
  }

  // CACHE-FIRST para JS, JSON e imágenes propias.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok && (
          url.pathname.endsWith('.js') ||
          url.pathname.endsWith('.json') ||
          url.pathname.match(/\.(png|jpg|svg|ico|webp)$/)
        )) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        if (e.request.mode === 'navigate') {
          return caches.match(e.request) || caches.match('./404.html') || caches.match('./offline.html');
        }
      });
    })
  );
});
