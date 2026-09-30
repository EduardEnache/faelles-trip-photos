/**
 * Øresund service worker. Only here for Background Fetch: phones hand their
 * uploads to the browser, which keeps sending them while the app is in the
 * background (see web/src/features/upload/background.ts). No fetch handler,
 * so nothing is cached and the app always loads from the network.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function tellPages(registration) {
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const page of pages) {
    page.postMessage({ type: 'faelles:bgfetch', id: registration.id, failureReason: registration.failureReason });
  }
}

self.addEventListener('backgroundfetchsuccess', (event) => {
  event.waitUntil(
    Promise.all([event.updateUI({ title: 'Uploaded to Øresund' }).catch(() => {}), tellPages(event.registration)]),
  );
});

self.addEventListener('backgroundfetchfail', (event) => {
  event.waitUntil(
    Promise.all([
      event.updateUI({ title: 'Upload paused. Open Øresund to finish it.' }).catch(() => {}),
      tellPages(event.registration),
    ]),
  );
});

self.addEventListener('backgroundfetchabort', (event) => {
  event.waitUntil(tellPages(event.registration));
});

self.addEventListener('backgroundfetchclick', (event) => {
  event.waitUntil(
    (async () => {
      const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = pages.find((p) => 'focus' in p);
      if (open) return open.focus();
      return self.clients.openWindow(new URL('./?upload=1', self.registration.scope).href);
    })(),
  );
});
