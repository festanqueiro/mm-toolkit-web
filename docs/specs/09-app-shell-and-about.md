# 09 — App Shell & About

## Shell

- Window title / document title: **MM Toolkit**.
- Tabs in order, each with a Material icon:

  | Tab | Icon |
  |---|---|
  | Video Creator | `music_video` |
  | Media Cutter | `content_cut` |
  | Media Converter | `swap_horiz` |
  | History | `history` (`notifications` while unread) |
  | Settings | `settings` |
  | About | `info` |

  Other icons used: `play_arrow`, `stop`, `delete`.
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

## PWA (Phase 4)

- Manifest: name "MM Toolkit", icons from `assets/mm-toolkit-icon.png` (generate 192/512 + maskable). Theme colour from tokens.
- The service worker precaches the app shell. ffmpeg.wasm is cached on first use.
- File Handling API (Chromium, installed): "Open with MM Toolkit" for audio/video → routes to Converter or Cutter.
- `navigator.setAppBadge` for unread history.
