# 13 — Hosting, CI & Release

## Hosting — GitHub Pages (ADR-002, decided 2026-10-02)

- **Static files only.** No functions or workers doing media work.
- **Host: GitHub Pages** (public repo, free), deployed by the official Actions flow (`actions/upload-pages-artifact` + `actions/deploy-pages`). URL: `https://festanqueiro.github.io/mm-toolkit-web/`. Vite `base` is `/mm-toolkit-web/` when `GITHUB_PAGES=1`.
- **No custom response headers on Pages.** Consequences:
  - **No cross-origin isolation**, so no `SharedArrayBuffer`, so **ffmpeg.wasm runs single-threaded**. This only affects the WASM fallback path. WebCodecs, WebGL, Workers, OffscreenCanvas, File System Access, OPFS, IndexedDB, Notifications and service workers all work. Audio-only WASM encodes are fast enough single-threaded; WASM *video* (AVI output, exotic inputs) gets slower.
  - Optional later: the **`coi-serviceworker`** shim fakes COOP/COEP from a service worker. It causes one reload on first visit, must be merged with the PWA service worker (one SW per scope), and needs every asset to be same-origin or CORP. Add it only if WASM speed proves to matter.
  - **CSP is shipped as a `<meta http-equiv>` tag**, injected into production builds by `vite.config.ts`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'self'`. A meta CSP can't set `frame-ancestors`; accept that.
- **Routing**: hash routes (`#/converter`), so no rewrite rules are needed.
- **Limits**: 100 MB per file, ~1 GB per site, soft 100 GB/month bandwidth. The ffmpeg.wasm core (~30 MB) fits. Large ML models (see the Stem Splitter in spec 14) may need splitting or a CORS-enabled CDN.
- **Self-host every asset** (fonts, ffmpeg core). No third-party CDNs at runtime.
- **Privacy**: no analytics by default. If ever added, they must never receive file names or contents.

## Repository conventions (carried over from desktop)

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `build:`), enforced by commitlint + husky.
- **Branching**: `main` is the only long-lived branch. Work on `feature/*`, `fix/*`, `chore/*`, with PRs into `main`. **Merging to `main` is a release** (deploy).
- **Versioning**: `package.json#version` is the single source of truth, injected into the app at build time (About, PWA cache name). **Every merge to `main` bumps patch.** Minor/major only when explicitly requested. Starts at **`0.1.0`**; `1.0.0` = feature parity with desktop.
- `CHANGELOG.md` (Keep a Changelog style), like desktop.
- `CODEOWNERS`: `* @festanqueiro`.

## CI (`.github/workflows/ci.yml`, on PRs into `main`)

1. **Secret scan**: `gitleaks/gitleaks-action@v2` (same as desktop).
2. **Lint + typecheck**: `npm run lint` (ESLint), `npm run check` (svelte-check).
3. **Unit**: `vitest run` (golden parity included).
4. **E2E**: Playwright with Chromium, WebKit, Firefox (`npx playwright install --with-deps`).
5. **Build**: `vite build`. Assert the bundle budget: initial JS ≤ 300 KB gzip, excluding lazily-loaded ffmpeg.wasm.

## Deploy & release

- **`deploy-pages.yml`**: build with `GITHUB_PAGES=1` (base `/mm-toolkit-web/`) and `MM_RELEASE=1` (no dev-build label), run the unit tests, then publish to GitHub Pages (`configure-pages` → `upload-pages-artifact` → `deploy-pages`). Reusable (`workflow_call`) and manual (`workflow_dispatch`, to redeploy `main` without a release).
- **`release.yml`** (on push to `main`):
  1. Fail if tag `v{version}` already exists (version not bumped). Same guard idea as desktop.
  2. Call `deploy-pages.yml`.
  3. Create GitHub Release `v{version}` with generated notes.

## Branch protection (`main`)

- Changes land **only via pull requests**. Direct pushes are blocked, as are force-pushes and branch deletion.
- **Repository admins can bypass** (classic protection with `enforce_admins: false`).
- No approving review is required (single maintainer). Required status checks can be added once CI names are stable.

PR previews: not available on GitHub Pages. Reviewers run `npm run build && npm run preview` locally, or download the CI build artefact.
