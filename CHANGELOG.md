# Changelog

All notable changes to MM Toolkit Web are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the
policy in `CLAUDE.md` (patch by default, minor/major only when requested).

## [Unreleased]

## [0.1.7] - 2026-10-02

### Added
- Brand identity from the logo:
  - A sticky header with the logo and wordmark, pill-style tabs and an "On-device" privacy badge.
  - A site footer and a skip-to-content link.
  - Favicons (32/64 px), an Apple touch icon, a web app manifest (192/512 px icons), theme colours and Open Graph/Twitter social-preview tags.

### Changed
- UI refresh:
  - Theme tokens built on the logo's blue and magenta, keeping AA contrast in light and dark.
  - Page headers with icon tiles, softer cards and shadows, and consistent button, input and focus styles.
  - Accordions with a rotating chevron and a summary of their state while collapsed.
- Video Creator:
  - Input is now two drop zones with icons and an inline thumbnail.
  - The preview has an empty state and scales small visuals up to fill the stage.
  - The effects list has drag handles.
  - The action bar floats above the page.
- About is a branded hero with tool chips, a "Private by design" note and the capabilities list. Unbuilt tools show a "Coming soon" card.

## [0.1.6] - 2026-10-02

### Added
- Video Creator right column:
  - Visual Effects stack: enable/disable, opacity/amount sliders and RPM. Reorder by dragging (mouse or touch) or with ↑/↓ on the handle.
  - Layers: solid colour swatch or background image, plus overlay image. PNGs are decoded byte-exact.
  - Post-Effects: mute original video sound (videos only) and video/audio fades.
  - Output: export folder with permission status (Chrome/Edge) or Downloads (Safari/Firefox), video profile, frame rate, Quality and audio bitrate.
- Live preview at up to 540 px: the full effect cascade, Layers and fades, playing along with the selected track's snippet and pulsing with its bass envelope.
- Clear resets inputs, effects and output; saved effects and fades are restored on load.

## [0.1.5] - 2026-10-02

### Added
- Video Creator inputs:
  - Audio: a file or a folder (direct children only, sorted like the desktop), or drag & drop.
  - Image or video: validated by actually decoding it, with a thumbnail.
  - The desktop's status messages.
- Audio timestamps table: per-track start/duration (kept when the selection changes), ▶/■ snippet preview through Web Audio, and ✨ drop detection with the "Detect drop start" dialog and the remembered lead-in.
- Requirements line, estimated duration and job estimate, using the desktop's wording.
- Audio decoding in a Worker at the native sample rate, normalised like the desktop's FFmpeg step. Includes an AIFF/AIFF-C reader.

### Fixed
- The forced dark theme was missing the warning colour.

## [0.1.4] - 2026-10-02

### Added
- WebGL2 effect cascade (`GlEffectRenderer`): overlay, bass-reactive radial
  blur, rotate, VHS and Glitch in any order, plus the video fade. Runs on an
  OffscreenCanvas (render Worker) or a page canvas (live preview).
  Byte-equal to the desktop golden frames for blur, rotate and overlay.
- Video and audio fades matching the desktop's moviepy fades.
- GL parity tests in real Chromium, WebKit and Firefox (Vitest browser mode,
  `npm run test:gl`), also run in CI.

### Changed
- VHS grain and Glitch slices now come from a plan shared by the CPU and GL
  paths (per-pixel hash noise), so both render identical frames.

## [0.1.3] - 2026-10-02

### Added
- Settings stored in IndexedDB with the desktop's key names and defaults.
- FileRef: file/folder references with persisted handles (Chromium) and
  permission re-request.
- Output sinks: write into a chosen folder honouring the desktop conflict
  policies (numbered copy / overwrite / skip), or stage in private browser
  storage for download — one file at a time or a single ZIP per batch.
- Settings tab: default export folder (where supported), notifications,
  naming templates with a live example and validation, existing-files policy,
  ZIP batches, output retention, large-file fallback and theme.

## [0.1.2] - 2026-10-02

### Added
- Audio analysis port: scipy-equivalent Butterworth SOS design and zero-phase
  `sosfiltfilt`, drop detection and bass envelope. Drop times match the desktop
  exactly; envelopes to 5e-7.
- CPU reference effects (radial blur, rotate, overlay, VHS, glitch, background
  and visual fitting) — bit-exact against the desktop for every deterministic
  effect, porting OpenCV resize/warpAffine (5.x kernels) and Pillow Lanczos.
- Effect settings model with desktop-compatible state JSON and lenient restore.
- Python `str.format`-compatible naming-template formatter.
- Golden fixtures extend to filter coefficients and naming templates, and record
  the desktop's library versions.

## [0.1.1] - 2026-10-02

### Added
- Phase 0 render spike: `/spike.html` renders a promo fully in the browser
  (WebGL bass-reactive blur in a Worker → WebCodecs H.264 + AAC/Opus → MP4
  via Mediabunny), with generated test media and `npm run bench` to drive it
  in Chrome, Chromium, WebKit and Firefox.
- `docs/benchmarks.md`: 60 s 1080×1920 promo renders in 8–10 s in
  Chrome/Safari/Firefox vs 33 s in the desktop app; WebKit bitrate and
  colour-range follow-ups recorded.

## [0.1.0] - 2026-10-02


### Added
- Project scaffold: Vite + Svelte 5 + TypeScript, Vitest, Playwright
  (Chromium/WebKit/Firefox), ESLint, svelte-check, commitlint + husky.
- App shell with hash-routed tabs (Video Creator, Media Cutter, Media
  Converter, History, Settings, About), theme tokens following the OS
  light/dark setting, and an About page with version, dev-build label and a
  per-browser capability summary.
- First engine ports, verified against the desktop golden fixtures:
  timestamp parsing/formatting (incl. Python banker's rounding), safe file
  names and conflict policies, media-kind/extension tables, semver helpers.
- CI (secret scan, lint, typecheck, unit, build, E2E matrix) and a release
  workflow that deploys to GitHub Pages and tags `v<version>`.
- MIT licence.
- Stem Splitter tool added to the roadmap backlog.
- Port specifications (`docs/specs/00`–`14`) covering every desktop tool, the
  audio-analysis and effects algorithms, persistence, file I/O, testing,
  hosting and roadmap.
- Browser feasibility research (`docs/research/browser-feasibility.md`).
- Golden parity fixtures generated from desktop MM Toolkit v1.0.2
  (`fixtures/golden/`) and the generator script.
- Read-only desktop engine/test snapshot (`docs/reference/`) and app assets.
