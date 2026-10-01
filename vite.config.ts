import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

/** Short commit (+dirty) for non-production builds; mirrors desktop `dev_build_label()`. */
function devBuildLabel(): string | null {
  if (process.env.MM_RELEASE === "1") return null;
  try {
    const commit = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf-8" }).trim() !== "";
    return dirty ? `${commit}+dirty` : commit;
  } catch {
    return null;
  }
}

/**
 * GitHub Pages can't send response headers, so the Content-Security-Policy ships as a
 * <meta> tag (spec 13). Production builds only: Vite's dev server needs inline/HMR access.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const cspMeta = {
  name: "csp-meta",
  apply: "build" as const,
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" as const }],
};

export default defineConfig({
  // GitHub Pages serves the site at /mm-toolkit-web/; local dev and tests use /.
  base: process.env.GITHUB_PAGES === "1" ? "/mm-toolkit-web/" : "/",
  plugins: [svelte(), cspMeta],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEV_BUILD__: JSON.stringify(devBuildLabel()),
  },
  worker: { format: "es" },
  build: {
    target: "es2022",
    rollupOptions: {
      // spike.html: Phase 0 benchmark page, deployed so any device can be measured.
      input: { main: "index.html", spike: "spike.html" },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
