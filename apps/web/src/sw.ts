/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope;

/**
 * ShopDesk service worker
 *  - precaches the app shell (HTML, JS, CSS, fonts, icons) so the app opens with no network
 *  - serves index.html for every navigation (SPA routes work offline)
 *  - never caches API responses: business data lives in IndexedDB, managed by the sync engine
 *  - Background Sync: wakes open clients to push pending operations when connectivity returns
 */

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// The first install takes control of the open page right away, so it is offline-capable without a reload.
// Updates still wait for the user's confirmation (SKIP_WAITING), never interrupting a sale.
clientsClaim();

registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/storage\//] }));

// API: always network (the app handles failures and works from IndexedDB).
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly());

// Uploaded images (product photos, logos, expense attachments).
registerRoute(
  ({ url }) => url.pathname.startsWith('/storage/'),
  new CacheFirst({ cacheName: 'shopdesk-media', plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 })] }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

interface SyncEvent extends ExtendableEvent {
  tag: string;
}

self.addEventListener('sync', (event) => {
  const syncEvent = event as SyncEvent;
  if (syncEvent.tag !== 'shopdesk-sync') return;
  syncEvent.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: 'shopdesk:sync' });
    }),
  );
});
