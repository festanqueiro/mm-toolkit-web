# 14 — Roadmap

## Phase 0 — Spike (≈ 1–2 days) — *de-risk before building*

- [ ] Render a **60 s 1080×1920 promo** from a WAV + PNG with **bass blur in WebGL + WebCodecs H.264 + AAC → MP4**, in a Worker, on Chrome, Safari and Firefox. Record the timings in `docs/benchmarks.md`.
- [ ] Calibrate the **Quality presets** (bpp/QP) against desktop CRF 18 output, side by side.
- [ ] Confirm AAC `AudioEncoder` availability per browser, plus the WASM AAC fallback timing.
- [ ] Confirm Mediabunny's container read/write list, and the ffmpeg.wasm LGPL build options (codecs available without x264).
- [ ] Decide **ADR-001** (UI framework), **ADR-002** (host), **ADR-003** (OGG Vorbis vs Opus), **ADR-004** (keep AVI output?).

## Phase 1 — Foundations

- [ ] Scaffold: Vite + TS + Vitest + Playwright + ESLint + commitlint/husky + CI.
- [ ] `engine/` pure ports: time, naming, template formatter, media-kind. Golden `pure.*` green.
- [ ] Audio analysis: filters, drop detection, envelope. Golden `audio.*` green.
- [ ] CPU effect reference. Golden `effects.*` green.
- [ ] App shell: tabs, routing, theming, Settings (persisted), capability detection, About.
- [ ] I/O: FileRef, handle persistence, Directory/Download/Zip sinks.

## Phase 2 — Video Creator (highest value)

- [ ] Inputs, per-track table, preview playback, drop detection dialog.
- [ ] GL effects + Layers + fades. GL ↔ CPU parity tests.
- [ ] **Live preview**.
- [ ] Render pipeline + batch + naming/conflicts + cancel/cleanup.
- [ ] History record + notifications.

## Phase 3 — Media Cutter & Media Converter

- [ ] Cutter: player/timeline, Set Start/End, clip table, WAV/AIFF in TS, AAC via WebCodecs, MP3/FLAC/OGG via WASM, video trim via Mediabunny.
- [ ] Preview fallbacks (waveform, proxy).
- [ ] Converter: the full matrix in [06](06-media-converter.md), WASM size ceiling, batch ZIP.

## Phase 4 — Polish → `1.0.0`

- [ ] History: Load Job with re-select flow, OPFS retention, inline preview.
- [ ] PWA: offline, install, update prompt, app badge, File Handling.
- [ ] Settings/history import from desktop.
- [ ] Accessibility pass: keyboard reordering for the effect list, focus management, ARIA on tables and progress.
- [ ] Docs: user guide with a browser-support matrix.

## Backlog (carried from desktop `TODO.md`)

- **Effects**: Black & White, Negative. VHS moving tracking bar. Layers-vs-cascade ordering toggle. Background enable/disable. Colour swatch on the Fill row. Legible drag-hint colour.
- **Rolling text overlay** (news-ticker style, per track), Prio 3.
- **History as task manager**: a live queue of dispatched jobs with status, Prio 3. This fits the web well, because one Worker can host a job queue.

## Web-only ideas

- **Lossless cut** mode in Media Cutter.
- **Short-track drop quirk**: offer an improved heuristic for tracks under ~28 s, behind a flag, without breaking parity defaults.
- **WebGPU** effect path for 4K native visuals.
- Multiple jobs in parallel on high-core machines (desktop is strictly sequential).
