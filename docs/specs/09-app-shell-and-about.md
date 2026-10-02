# 09 — App Shell & About

## Shell

- Document title: `{Tab} · MM Toolkit`.
- **Header** (web): a sticky bar with the logo (32 px) and the **MM Toolkit** wordmark, pill tabs (the active one in the accent colour), and an **On-device** badge. Below ~980 px the tabs move to a scrolling row under the brand. A footer repeats the privacy line, the version and the GitHub link.
- **Brand**: the logo's sky blue `#7cc5ff` and magenta `#f840d0` (`--brand-blue`, `--brand-pink`). Text-bearing accents use AA-safe shades per theme. Icons: favicons 32/64 px, Apple touch icon, and the manifest's 192/512 px icons, all generated from `assets/mm-toolkit-logo.png`. Social preview: `public/social-preview.png`.
- Tabs in order, each with a Material icon:

  | Tab | Icon |
  |---|---|
  | Video Creator | `music_video` |
  | Media Cutter | `content_cut` |
  | Media Converter | `swap_horiz` |
  | History | `history` (`notifications` while unread) |
  | Settings | `settings` |
  | About | `info` |

  Other icons used: `play_arrow`, `stop`, `delete`, `expand_more`, `folder_open`, `audiotrack`, `image`, `lock`, `drag_indicator`.
- **Routing**: one hash route per tab (`#/video-creator`, `#/cutter`, `#/converter`, `#/history`, `#/settings`, `#/about`) so reloads keep the tab. Hash routing needs no server rewrites.
- Desktop sizing: min 820×620, default 1100×820. Web: responsive. Two-column tool layouts collapse to one column below ~900 px.
- Page padding 28/24 px. Section spacing 10–14 px. Primary action buttons are at least 44 px tall.
- **Theme**: follow `prefers-color-scheme` by default (desktop follows the OS palette). Colour tokens are defined once.
- **Leaving during a job**: desktop blocks closing with "Rendering in progress — Wait for rendering to finish before closing the app." Web: a `beforeunload` prompt while any job or drop analysis is running. Also request a **Screen Wake Lock** while jobs run (where supported).
- **Status conventions**: positive states start with `✓ `. "Requirements" text always explains why the primary button is disabled (`To enable X: a; b; c.`).
- **Error dialogs**: a title, a short message, and expandable **details** (stack/log). This mirrors desktop `show_error`.

## About

Centred column:

- The **MM Toolkit logo** (`assets/mm-toolkit-logo.png`, max 300 px).
- **"MM Toolkit"** (22 pt, semi-bold).
- `Version {version}`.
- Dev build line, in muted text: `Dev build {short-sha}[+dirty]`. Shown only in non-production builds. Inject the value at build time; there's no runtime `git`.
- An update-available link (desktop only; see below).
- The tagline **"Audio & Video tools for all"**.
- A repository link. Decide whether to link the web repo, the desktop repo, or both.
- The credit: *"Google Material Icons used under the Apache License 2.0."*, linking to https://fonts.google.com/icons.
- **Web addition**: a capabilities summary (e.g. "Hardware video encoding: available · Export to folder: not supported in this browser (files go to Downloads)") to explain Tier 2 differences.

### Update check

Desktop calls `GET https://api.github.com/repos/festanqueiro/mm-toolkit/releases/latest`. If `tag_name` is a newer semver than `__version__` and `html_url` starts with the repo's releases URL, it shows `Download MM Toolkit {version}`.

The web app is always the deployed version, so **drop the GitHub check**. With the PWA service worker, show **"A new version is available — Reload"** when a new worker is waiting. Port `versionTuple`/`isNewerVersion` anyway: they're tested (golden `pure.versionTuple`, `pure.isNewerVersion`) and useful for the "what's new" prompt.

Version semantics: `/^v?(\d+)\.(\d+)\.(\d+)$/` after trimming. Anything else isn't a version, so it's never "newer".

## Tool layout (web redesign, 2026-10-02)

Design: [tool layout redesign](../superpowers/specs/2026-10-02-tool-layout-redesign-design.md). Applies to the Video Creator, Media Cutter, Media Converter and Stem Splitter.

- Tool pages are up to **1440 px** wide (other pages 1240 px). The page header spans the width; below it, a **setup** column and an **output rail** (`clamp(340px, 28%, 420px)`, gap 20 px; never scrolls sideways).
- **Setup**: always-open sections (`h2` + an optional quiet status). No accordions, no step guidance.
- **Output rail** (`aside` "Output"), sticky below the site header and scrolling internally when taller than the screen: **Preview** (Video Creator) → **Export** (the tool's output settings) → the **action** (requirements, primary button, progress + Cancel, warnings, Clear; pinned to the rail's bottom) → the inline **error** card (`role="alert"`, Details, Dismiss) → **Results**.
- **Results**: after a job, `Saved to {folder}` or `Downloaded` plus `Open in History`, then one row per output with its size, a player and **Download**. Replaced by the next job's; emptied by Clear.
- **Under 1000 px**: one column (setup, then the rail blocks) and a sticky bottom bar with the action. No horizontal overflow at 390 px.

## Home (web-only, requested 2026-10-02)

- The landing page (`#/`, no hash, or any unknown route) is **Home**; it isn't a tab. The brand logo links to it (`aria-current="page"` while there); the tool tabs are unchanged. Document title: `MM Toolkit`.
- Hero: `Audio & video tools, right in your browser` + one sentence that ends with the privacy promise (`your files are never uploaded.`).
- One card per tool, in tab order (Video Creator, Media Cutter, Media Converter, Stem Splitter): icon, a one-line summary, four concrete capabilities, `Open {tool} →`. The whole card is the link. Copy lives in `ui/tools.ts` and must only claim what the tool does today.
- Footer line: works offline once loaded; links to History and Settings.

## PWA (Phase 4)

- Manifest: name "MM Toolkit", icons from `assets/mm-toolkit-icon.png` (generate 192/512 + maskable). Theme colour from tokens.
- The service worker precaches the app shell. ffmpeg.wasm is cached on first use.
- File Handling API (Chromium, installed): "Open with MM Toolkit" for audio/video → routes to Converter or Cutter.

### As built

- **Service worker** (`scripts/sw-template.js`, emitted as `sw.js` by a build plugin; `scripts/pwa.ts` builds the list): precaches the app shell (`./`) and every built/public file except the social image and the spike page, in the cache `mm-toolkit-{version}`. Cache-first; any in-scope navigation gets the cached shell. Old versions' caches are deleted on activation. Registered in production builds only, scoped to the base URL.
- **Install integrity**: the precache bypasses the HTTP cache (`cache: "reload"`; GitHub Pages sends `max-age=600`), and the install **fails** if the cached shell references any `assets/…` file outside this version's precache (a stale `index.html`, or a CDN mid-deploy). A failed install is retried on a later visit. (0.1.13–0.1.15 lacked this: a stale shell could be precached, and the app then 404'd on its own scripts.)
- **Updates**: a new version **activates by itself** (`skipWaiting`): a page that can't boot can't show a prompt, so waiting for a click could strand users. The previous version's cache is kept (older ones deleted) and assets are looked up in every cache, so an already-open page keeps lazy-loading its own chunks. When the open page's controller changes, it shows `A new version is available` + **Reload**. Checked hourly and when the app returns to the foreground.
- **Install**: Chromium's install prompt is deferred; About shows **Install app** while it's available.
- **Manifest**: `id`, maskable 512 px icon (logo on the dark background, inside the safe zone), shortcuts to the three tools, `launch_handler: focus-existing`, and `file_handlers` for every audio/video input extension.
- **File Handling**: launched files go to the Media Cutter (one usable file) or the Media Converter (several); unsupported files are dropped (`engine/launch.ts`).
- **App badge**: `History ({n})` mirrors to `navigator.setAppBadge` (spec 07).
- `navigator.setAppBadge` for unread history.
