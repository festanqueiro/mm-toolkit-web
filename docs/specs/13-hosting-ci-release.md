# 13 — Hosting, CI & Release

## Hosting

- **Static files only.** No functions or workers doing media work. (A CDN edge that only serves files is fine.)
- **Recommended host: Cloudflare Pages** (or Netlify). Both support custom headers via `_headers`, and both work from a **private** GitHub repo on free tiers. GitHub Pages is a poor fit: it can't set COOP/COEP headers, and Pages on private repos needs a paid plan.
- Headers (only needed for multi-threaded ffmpeg.wasm / `SharedArrayBuffer`):

  ```
  /*
    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp   # or "credentialless" (Chromium/Firefox)
  ```

  With `require-corp`, **every asset must be same-origin or send CORP**. Self-host fonts and the ffmpeg core; no third-party CDNs.
- **CSP**: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'`. Tighten further where possible.
- **Privacy**: no analytics by default. If ever added, they must never receive file names or contents.

## Repository conventions (carried over from desktop)

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `build:`), enforced by commitlint + husky.
- **Branching**: `main` is the only long-lived branch. Work on `feature/*`, `fix/*`, `chore/*`, with PRs into `main`. **Merging to `main` is a release** (deploy).
- **Versioning**: `package.json#version` is the single source of truth, injected into the app at build time (About, PWA cache name). **Every merge to `main` bumps patch.** Minor/major only when explicitly requested. Starts at **`0.1.0`**; `1.0.0` = feature parity with desktop.
- `CHANGELOG.md` (Keep a Changelog style), like desktop.
- `CODEOWNERS`: `* @festanqueiro`.

## CI (`.github/workflows/ci.yml`, on PRs into `main`)

1. **Secret scan**: `gitleaks/gitleaks-action@v2` (same as desktop).
2. **Lint + typecheck**: `eslint`, `tsc --noEmit`.
3. **Unit**: `vitest run` (golden parity included).
4. **E2E**: Playwright with Chromium, WebKit, Firefox (`npx playwright install --with-deps`).
5. **Build**: `vite build`. Assert the bundle budget: initial JS ≤ 300 KB gzip, excluding lazily-loaded ffmpeg.wasm.

## Release (`.github/workflows/release.yml`, on push to `main`)

1. Build.
2. Deploy to the static host's production environment.
3. Create a GitHub Release/tag `v{version}` with the build artefact (zip of `dist/`) and changelog notes.
4. Fail if the tag already exists (i.e. the version wasn't bumped). Same guard idea as desktop.

PR previews: Cloudflare Pages preview deployments per branch.
