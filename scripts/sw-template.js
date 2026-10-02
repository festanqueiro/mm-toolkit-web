/* MM Toolkit service worker (spec 09 "PWA"). The build injects VERSION and PRECACHE.
 *
 * Offline after the first load: every built file is precached under a versioned cache and
 * served cache-first; navigations get the cached app shell.
 *
 * Updates activate on their own (no waiting): a page that can't boot can't show a "Reload"
 * prompt, so waiting for a click could strand users on a broken version. An already-open
 * page keeps working because the previous version's cache is kept and assets are looked up
 * in every cache (hashed names never collide); the page then offers "Reload" to switch. */
const VERSION = "__VERSION__";
// eslint-disable-next-line no-undef -- replaced by the build with the file list.
const PRECACHE = __PRECACHE__;
const PREFIX = "mm-toolkit-";
const CACHE = `${PREFIX}${VERSION}`;
const scope = self.registration.scope;
const shell = new URL("./", scope).href;

/** Versions newest first (`mm-toolkit-0.1.15` → [0, 1, 15]). */
const versionOf = (key) => key.slice(PREFIX.length).split(".").map((n) => parseInt(n, 10) || 0);
const newestFirst = (a, b) => {
  const [x, y] = [versionOf(a), versionOf(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
  return 0;
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Bypass the HTTP cache (GitHub Pages sends max-age=600): a stale index.html paired
      // with this version's assets would reference files that no longer exist.
      const requests = PRECACHE.map((path) => new Request(new URL(path, scope).href, { cache: "reload" }));
      await cache.addAll(requests);
      // Refuse an inconsistent shell (e.g. a CDN still propagating a deploy): every asset it
      // references must be in this precache. A failed install is simply retried later.
      const html = await (await cache.match(shell)).text();
      const listed = new Set(PRECACHE);
      const missing = [...html.matchAll(/(?:src|href)="[^"]*?(assets\/[^"?#]+)"/g)].map((m) => m[1]).filter((path) => !listed.has(path));
      if (missing.length) {
        await caches.delete(CACHE);
        throw new Error(`Shell references assets outside this version: ${missing.join(", ")}`);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Keep this version and the one before it (open pages may still lazy-load its chunks).
      const ours = (await caches.keys()).filter((key) => key.startsWith(PREFIX) && key !== CACHE).sort(newestFirst);
      for (const key of ours.slice(1)) await caches.delete(key);
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
    // Any in-scope page (including File Handling launches) is this version's app shell.
    event.respondWith(caches.match(shell, { cacheName: CACHE }).then((hit) => hit || fetch(request)));
    return;
  }
  // Assets from any kept version (an open older page's lazy chunks); others (the ONNX Runtime
  // WASM) are cached on first use.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && new URL(request.url).pathname.includes("/assets/")) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
