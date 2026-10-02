/**
 * Build helpers for the service worker (spec 09 "PWA"): which files to precache and the
 * final `sw.js` source. Kept out of vite.config.ts so they can be unit-tested.
 */

/**
 * Built files not worth precaching: the social preview (crawlers only), the Phase 0 spike
 * page, and the 28 MB ONNX Runtime WASM, which only the Stem Splitter needs (the worker
 * caches it on first use instead).
 */
const SKIP = [/^social-preview\.png$/, /^spike\.html$/, /^assets\/spike-/, /^sw\.js$/, /\.map$/, /^assets\/ort-wasm[^/]*\.wasm$/];

/**
 * Precache list: every emitted/public file, as scope-relative paths, plus the app shell `./`
 * (always: Vite emits `index.html` after other plugins' `generateBundle` has run).
 */
export function precacheList(files: string[]): string[] {
  const list = files.filter((f) => !SKIP.some((re) => re.test(f)) && f !== "index.html");
  return [...new Set(["./", ...list])].sort();
}

export function serviceWorkerSource(template: string, version: string, files: string[]): string {
  return template.replace('"__VERSION__"', JSON.stringify(version)).replace("__PRECACHE__", JSON.stringify(precacheList(files)));
}
