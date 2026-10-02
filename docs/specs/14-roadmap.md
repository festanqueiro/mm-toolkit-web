# 14 — Roadmap

## Phase 0 — Spike (≈ 1–2 days) — *de-risk before building*

- [x] Render a **60 s 1080×1920 promo** from a WAV + PNG with **bass blur in WebGL + WebCodecs H.264 + AAC → MP4**, in a Worker, on Chrome, Safari and Firefox. Record the timings in `docs/benchmarks.md`. → 8–10 s in Chrome/Safari/Firefox vs 33 s desktop.
- [ ] Calibrate the **Quality presets** (bpp/QP) against desktop CRF 18 output, side by side. Preliminary: High ≈ 0.14 bpp; a VMAF comparison is pending.
- [ ] WebKit: bitrates not honoured (AAC capped ~67 kb/s, video ~50 %). Investigate encoder modes; route AAC to WASM when the achieved bitrate is too low.
- [ ] Force limited-range BT.709 output (WebKit/Chromium emitted full range).
- [x] Confirm AAC `AudioEncoder` availability per browser: Chrome ✓, WebKit ✓ (bitrate capped), Firefox ✗ (Opus used).
- [ ] Measure the WASM AAC fallback timing.
- [ ] Confirm Mediabunny's container read/write list, and the ffmpeg.wasm LGPL build options (codecs available without x264).
- [x] **ADR-001** UI framework → **Svelte 5**. **ADR-002** host → **GitHub Pages** (public repo). Licence → **MIT**.
- [ ] Decide **ADR-003** (OGG Vorbis vs Opus) and **ADR-004** (keep AVI output?). Media Cutter writes Opus in Ogg meanwhile (no web Vorbis encoder without ffmpeg.wasm).

## Phase 1 — Foundations

- [x] Scaffold: Vite + TS + Svelte 5 + Vitest + Playwright + ESLint + commitlint/husky + CI + Pages deploy.
- [x] `engine/` pure ports: time, naming, media-kind, version. Golden `pure.*` green.
- [x] Template formatter (Python `str.format` subset; golden `pure.templates`).
- [x] Audio analysis: filters, drop detection, envelope. Golden `audio.*` green (drop times exact, envelope 5e-7).
- [x] CPU effect reference. Golden `effects.*` green: **bit-exact** for every deterministic effect.
- [x] App shell: tabs, routing, theming, Settings (persisted), capability detection, About.
- [x] I/O: FileRef, handle persistence, Directory/Download/Zip sinks.

## Phase 2 — Video Creator (highest value)

- [x] Inputs, per-track table, preview playback, drop detection dialog. (Inputs aren't persisted yet; that lands with the render pipeline, since desktop saves them when generation starts.)
- [x] GL effects + Layers + fades. GL ↔ CPU parity tests (Chromium/WebKit/Firefox: blur, rotate and overlay byte-equal to the golden frames).
- [x] **Live preview**, plus the right column: effect stack (drag or ↑/↓ to reorder), Layers, Post-Effects, Output (export folder, profile, fps, quality, audio bitrate) and Clear.
- [x] Render pipeline + batch + naming/conflicts + cancel/cleanup.
- [x] History record + notifications. (The History tab UI is Phase 4.)

## Phase 3 — Media Cutter & Media Converter

- [x] Cutter: player/timeline, Set Start/End, clip table, WAV/AIFF in TS, AAC via WebCodecs (WASM fallback), MP3/FLAC via Mediabunny's WASM encoders, video trim via Mediabunny. OGG is Opus-in-Ogg until ADR-003.
- [x] Cutter preview fallbacks: waveform + chunked Web Audio for audio, decoded frames for video (no transcoded proxy needed).
- [x] Converter: the matrix in [06](06-media-converter.md) except AVI output (ADR-004), batch ZIP, resumable page-decode fallback. The Cutter and Converter share `engine/render/transcode.ts`.

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

## New tool: Stem Splitter (requested 2026-10-02, not in desktop)

Separate a track into stems (vocals, drums, bass, other), fully client-side like everything else.

- **Approach:** run a pretrained source-separation model in the browser with **ONNX Runtime Web** (WebGPU backend, WASM fallback). Candidate: **HTDemucs** (Demucs v4, MIT-licensed) exported to ONNX. Alternatives: Spleeter-class 2/4-stem models (smaller, lower quality), or a lighter MDX-Net variant.
- **Pipeline:**
  1. Decode to 44.1 kHz stereo PCM (the model's rate, so it must resample).
  2. Chunk with overlap (e.g. ~8 s segments, cross-faded).
  3. Run inference per chunk in a Worker.
  4. Overlap-add the chunks into per-stem buffers.
  5. Export each stem through the existing audio encoders and naming/sink (`{source} - {stem}`).
- **Constraints to check in a spike:**
  - Model download size: HTDemucs is in the ~80–300 MB range depending on variant and quantisation. Self-host it, lazy-load it, and cache it in OPFS / the Cache API.
  - Inference time per minute of audio on WebGPU vs. WASM (WASM may be impractically slow for full tracks).
  - Peak memory (activations for long chunks).
  - WebGPU availability per browser.
- **UI sketch:** a source picker, stem preset (2-stem vocals/accompaniment or 4-stem), output format (reuses Converter formats), a per-stem preview/solo player, and Export.
- **Hosting:** model files on GitHub Pages count toward its limits (100 MB per file, ~1 GB site). Split or quantise the weights, or host them on a CDN that sends CORS/CORP headers. That still counts as static file serving, with no server-side processing.
- Phase: after `1.0.0` (desktop parity), unless prioritised earlier.

## Web-only ideas

- **Lossless cut** mode in Media Cutter.
- **Short-track drop quirk**: offer an improved heuristic for tracks under ~28 s, behind a flag, without breaking parity defaults.
- **WebGPU** effect path for 4K native visuals.
- Multiple jobs in parallel on high-core machines (desktop is strictly sequential).
