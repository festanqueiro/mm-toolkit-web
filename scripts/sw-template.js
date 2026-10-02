/* MM Toolkit service worker (spec 09 "PWA"). The build injects VERSION and PRECACHE.
 * Offline after the first load: every built file is precached under a versioned cache and
 * served cache-first; navigations get the cached app shell. A new version waits until the
 * page asks it to take over ("A new version is available — Reload"). */
const VERSION = "__VERSION__";
// eslint-disable-next-line no-undef -- replaced by the build with the file list.
const PRECACHE = __PRECACHE__;
const CACHE = `mm-toolkit-${VERSION}`;
const scope = self.registration.scope;
const shell = new URL("./", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((path) => new URL(path, scope).href))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("mm-toolkit-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(scope)) return;
  if (request.mode === "navigate") {
    // Any in-scope page (including File Handling launches) is the single-page app shell.
    event.respondWith(caches.match(shell, { cacheName: CACHE }).then((hit) => hit || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(request)));
});
