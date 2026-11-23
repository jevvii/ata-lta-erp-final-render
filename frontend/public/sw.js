/**
 * Legacy service-worker kill-switch.
 *
 * The pre-React prototype registered `sw.js?v=2.3.13` at the site root and served
 * the SPA shell cache-first from `erp-shell-v41`. The React app ships no service
 * worker, so that registration would otherwise stay in control forever: when an
 * update check receives a 404, the service-worker specification rejects the
 * update and keeps the existing worker active.
 *
 * This file must stay reachable at `/sw.js` (any query string) so browsers that
 * still hold the legacy registration can replace it. Once active it:
 *   1. deletes the prototype-era caches (`erp-*`),
 *   2. unregisters the registration completely,
 *   3. reloads controlled windows so they load the live deployment.
 *
 * It is inert for visitors that never had the legacy worker. Do not delete it
 * while any client could still hold the old registration.
 */

const LEGACY_CACHE_PREFIX = 'erp-';

function isLegacyCache(name) {
  return typeof name === 'string' && name.startsWith(LEGACY_CACHE_PREFIX);
}

self.addEventListener('install', () => {
  // Take over from the stale worker without waiting for existing clients.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      let cacheKeys = [];
      try {
        cacheKeys = await caches.keys();
      } catch (error) {
        console.warn('[SW kill-switch] Unable to enumerate caches:', error);
      }

      await Promise.allSettled(
        cacheKeys.filter(isLegacyCache).map((key) => caches.delete(key))
      );

      try {
        await self.clients.claim();
      } catch (error) {
        console.warn('[SW kill-switch] Unable to claim clients:', error);
      }

      let windowClients = [];
      try {
        windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
      } catch (error) {
        console.warn('[SW kill-switch] Unable to enumerate clients:', error);
      }

      // Unregister before reloading so the new document is not controlled by
      // any service worker.
      try {
        await self.registration.unregister();
      } catch (error) {
        console.warn('[SW kill-switch] Unable to unregister:', error);
      }

      for (const client of windowClients) {
        if (!client || !client.url || typeof client.navigate !== 'function') {
          continue;
        }
        try {
          await client.navigate(client.url);
        } catch {
          // The client may already be unloading; nothing else to do.
        }
      }
    })()
  );
});
