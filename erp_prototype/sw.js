/**
 * Service worker for the ATA & LTA ERP SPA.
 *
 * Caching strategy:
 *   - Cache-First: SPA shell (HTML, CSS, JS, fonts, logo images).
 *   - Stale-While-Revalidate: safe read-only GET API endpoints.
 *   - Network-First: everything else (writes, auth, PDFs).
 *
 * Build-time hash injection: if `self.__WB_MANIFEST` is present (e.g. injected by
 * a bundler), those URLs are added to the app-shell cache. Otherwise a static
 * fallback list is used.
 */
const CACHE_VERSION = 'v2';
const SHELL_CACHE = `erp-shell-${CACHE_VERSION}`;
const API_CACHE = `erp-api-${CACHE_VERSION}`;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/env.js',
  '/js/utils.js',
  '/js/apiClient.js',
  '/js/auth.js',
  '/js/app.js',
  '/js/dataTable.js',
  '/js/kanban.js',
  '/js/datepicker.js',
  '/js/timepicker.js',
  '/js/dashboard.js',
  '/js/clients.js',
  '/js/workflow.js',
  '/js/billing.js',
  '/js/disbursement.js',
  '/js/dms.js',
  '/js/reports.js',
  '/js/transmittal.js',
  '/js/pendingChanges.js',
  '/js/users.js',
  '/js/profile.js',
];

const MANIFEST_URLS = (self.__WB_MANIFEST || []).map(entry =>
  typeof entry === 'string' ? entry : entry.url
).filter(Boolean);

const APP_SHELL_URLS = new Set([...SHELL_URLS, ...MANIFEST_URLS]);

const SAFE_API_PATHS = [
  /^\/v1\/me(\/|$)/,
  /^\/v1\/clients(\/|$)/,
  /^\/v1\/work-requests(\/|$)/,
  /^\/v1\/reports\/analytics(\/|$)/,
  /^\/v1\/reports\/dashboard(\/|$)/,
];

function isSameOrigin(url) {
  return url.origin === location.origin;
}

function isShellAsset(url, request) {
  const path = url.pathname;
  if (APP_SHELL_URLS.has(path)) return true;
  if (APP_SHELL_URLS.has('/' + path)) return true;
  const ext = path.split('.').pop()?.toLowerCase();
  if (['css', 'js', 'woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return true;
  if (request.destination === 'font' || request.destination === 'image' || request.destination === 'style' || request.destination === 'script') {
    return true;
  }
  return false;
}

function isSafeApi(url) {
  return SAFE_API_PATHS.some(re => re.test(url.pathname));
}

function isWriteOrAuthOrPdf(request) {
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') return true;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/v1/auth/')) return true;
  if (url.pathname.includes('/pdf')) return true;
  if (request.destination === 'document' && url.pathname.startsWith('/v1/')) return true;
  return false;
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async cache => {
      for (const url of APP_SHELL_URLS) {
        try {
          const response = await fetch(url, { cache: 'no-cache' });
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch (e) {
          // Missing assets are expected in bundled production builds where the
          // source scripts are replaced by hashed bundles. They will be cached
          // at runtime on first request.
        }
      }
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== SHELL_CACHE && key !== API_CACHE).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    return new Response('Offline: asset not available', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);

  const fetchAndCache = async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cloned = response.clone();
        const headers = new Headers(cloned.headers);
        headers.set('x-sw-cached-at', Date.now().toString());
        const wrapped = new Response(cloned.body, { status: cloned.status, statusText: cloned.statusText, headers });
        cache.put(request, wrapped);
      }
      return response;
    } catch (e) {
      return null;
    }
  };

  const network = fetchAndCache();

  if (cached) {
    const cachedAt = parseInt(cached.headers.get('x-sw-cached-at') || '0', 10);
    const age = Date.now() - cachedAt;
    if (age < 5 * 60 * 1000) {
      network.catch(() => {});
      return cached;
    }
  }

  const networkResponse = await network;
  if (networkResponse) return networkResponse;
  return cached || new Response(JSON.stringify({ error: 'Network unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch (e) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    return cached || new Response('Offline: resource unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignore non-HTTP(S) requests (e.g. chrome-extension).
  if (!url.protocol.startsWith('http')) return;

  // Never cache cross-origin requests.
  if (!isSameOrigin(url)) return;

  // Never intercept write/auth/PDF requests.
  if (isWriteOrAuthOrPdf(request)) return;

  if (isShellAsset(url, request)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isSafeApi(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Default: network-first with shell fallback.
  event.respondWith(networkFirst(request));
});
