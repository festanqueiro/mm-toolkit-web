import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { serviceWorkerSource } from "./scripts/pwa";

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
  // The Stem Splitter downloads its model from Hugging Face (spec 15); no user data is sent.
  "connect-src 'self' blob: data: https://huggingface.co https://*.hf.co",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const cspMeta = {
  name: "csp-meta",
  apply: "build" as const,
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" as const }],
};

/**
 * Emit the service worker (spec 09 "PWA") with every built and public file to precache and
 * the app version as its cache name. Production builds only.
 */
const serviceWorker = {
  name: "service-worker",
  apply: "build" as const,
  generateBundle(this: { emitFile: (file: { type: "asset"; fileName: string; source: string }) => void }, _options: unknown, bundle: Record<string, unknown>) {
    const publicFiles = readdirSync("public");
    const template = readFileSync("scripts/sw-template.js", "utf8");
    this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorkerSource(template, pkg.version, [...Object.keys(bundle), ...publicFiles]) });
  },
};

export default defineConfig({
  // GitHub Pages serves the site at /mm-toolkit-web/; local dev and tests use /.
  base: process.env.GITHUB_PAGES === "1" ? "/mm-toolkit-web/" : "/",
  plugins: [svelte(), cspMeta, serviceWorker],
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
    projects: [
      // Pure engine code in Node (fast, no browser).
      { extends: true, test: { name: "unit", include: ["tests/**/*.test.ts"], exclude: ["tests/browser/**"], environment: "node" } },
      // WebGL parity against the CPU reference, in real engines (spec 12, layer 2).
      {
        extends: true,
        test: {
          name: "gl",
          include: ["tests/browser/**/*.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            // CI's Firefox sometimes blocklists Mesa's software GL at startup; skip that check.
            provider: playwright({ launchOptions: { firefoxUserPrefs: { "webgl.force-enabled": true } } }),
            screenshotFailures: false,
            instances: [{ browser: "chromium" }, { browser: "webkit" }, { browser: "firefox" }],
          },
        },
      },
    ],
  },
});
