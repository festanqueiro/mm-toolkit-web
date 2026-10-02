# Changelog

All notable changes to MM Toolkit Web are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the
policy in `CLAUDE.md` (patch by default, minor/major only when requested).

## [Unreleased]

## [0.1.14] - 2026-10-02

### Added
- **Stem Splitter** tab: split a song (or a video's soundtrack) into vocals, drums, bass, other, or vocals + instrumental, entirely on this device.
  - HT-Demucs v4 (MIT). The 170 MB model downloads once from Hugging Face (only the model; your audio never leaves the device), is checked for integrity, and is kept for offline use.
  - Runs on the GPU (WebGPU) where available, else on the CPU (slower, with a note).
  - Any audio output format (WAV by default), inline players for the results, export folder or Downloads/ZIP, progress, Cancel, History and Load Job.

### Fixed
- Pressing Cancel while a job was still preparing was ignored (all tools).
- WebKit: Cancel could be lost in the Media Cutter and Media Converter (the job worker's entry module was loaded twice).

## [0.1.13] - 2026-10-02

### Added
- **Works offline** after the first visit: the whole app, including its workers and codecs, is cached on the device.
- **Update prompt**: when a new version is ready, "A new version is available — Reload" (it never swaps versions under a running job).
- **Install app** (on About, where the browser offers it), with a maskable icon and shortcuts to each tool.
- **Open with MM Toolkit** (installed Chrome/Edge): one audio/video file opens in the Media Cutter, several in the Media Converter.

## [0.1.12] - 2026-10-02

### Added
- **History** tab: recent jobs (newest 20), each output that still exists (in your export folder, or kept in browser storage), inline preview, Download / Download all, Clear History.
- **Load Job** restores a job's settings in its tool (Video Creator, Media Cutter, Media Converter) and names the files to re-select; Video Creator re-applies saved per-track timings when the same tracks are picked again.
- Finished jobs show `History (n)` and the app badge until History is opened; the finished status line links to the job.
- "Keep copies of outputs for History" now keeps copies across sessions within 2 GB (oldest removed first) and shows the space used.

### Fixed
- Switching export folders quickly could leave the previous folder's handle in use.

## [0.1.11] - 2026-10-02

### Added
- **Media Converter** tab: convert batches of audio or video files, fully in a Worker.
  - Add files by picker or drag & drop; Remove Selected; Preview Selected plays inline. Mixed or unusable batches are explained.
  - Audio → MP3 (128–320 kbps), WAV/AIFF 24-bit, FLAC, M4A/AAC 256k, OGG (Opus 192k until ADR-003).
  - Video → MP4/MOV/MKV (H.264 + AAC) or WebM (VP9 + Opus) at the source size. AVI is listed but not available in the browser yet (ADR-004).
  - `{name}.{format}` with the conflict policy, export folder (Chrome/Edge) or Downloads/ZIP, progress, Cancel, the "Conversion failed" dialog, History and the "Conversion finished" notification.
- A streaming resampler (identical to the one-shot one) so long files resample without being held in memory.

### Changed
- The Cutter and the Converter share one transcoding engine and one job Worker.
- Opus is always encoded at 48 kHz, and AAC at 48 kHz unless the source is 44.1/48 kHz: WebKit's encoders fail or write broken ADTS at unusual rates. FLAC at a rate the WASM encoder lacks (e.g. 11.025 kHz) is resampled to a supported one instead of falling through to WebKitGTK's broken native encoder.

## [0.1.10] - 2026-10-02

### Added
- Media Cutter previews sources the browser can't play natively:
  - Audio (e.g. AIFF in Chrome/Firefox): a waveform you can click or drag to seek, with playback decoded in short chunks around the playhead.
  - Video (e.g. MKV in Safari): decoded frames on a canvas while scrubbing and playing, with the soundtrack.
  - Set Start / Set End and per-clip ▶ preview work in every mode.

### Changed
- AIFF is read by byte range (header chunks + the needed span) instead of loading the whole file, for the Cutter and the Video Creator's snippet decoding.

## [0.1.9] - 2026-10-02

### Added
- **Media Cutter** tab: cut audio or video into precisely timed clips, fully in a Worker.
  - Source picker with drag & drop, a native player with a timeline, Play/Pause, and **Set Start / Set End** into the current row (`Editing: {clip}`).
  - Clip table: Title / Start / End / Duration, ▶ preview that stops at the clip end, remove, **+ Add clip**, and the desktop's validation messages.
  - Video → H.264 + AAC MP4 at the source size (frame-accurate re-encode). Audio keeps its format: WAV/AIFF as 24-bit PCM, MP3 320k, FLAC, M4A/AAC 320k. OGG is Opus in Ogg until ADR-003 decides on Vorbis.
  - Naming template and conflict policy, export folder (Chrome/Edge) or Downloads/ZIP, progress, Cancel, the "Clip creation failed" dialog, History records and the "Clips finished" notification.
- WASM MP3, FLAC and AAC encoders (Mediabunny extensions), loaded only when the browser has no native encoder.
- A pure-TS FLAC decoder, bit-exact and used in every browser (WebKit's WebCodecs FLAC decoder fails at runtime).
- A decode stall watchdog: audio an engine claims to decode but hangs on (WebKitGTK's Vorbis) falls back to Web Audio at the native rate, in the Cutter and in Video Creator decoding.

### Changed
- Shared building blocks for tools: export folder, drop zone, job footer and the Worker job runner (the Video Creator now uses them too).

## [0.1.8] - 2026-10-02

### Added
- **Generate Video(s)**: the full promo render in a Worker.
  - Per track: snippet decode, bass envelope, Layers, the WebGL effect cascade and video fade, the audio fade, and the optional looped original video sound.
  - Encoding: WebCodecs H.264 + AAC (Opus/VP9/AV1 fallbacks with a warning), written to MP4.
  - Output: into the chosen folder with the naming template and conflict policy (Chrome/Edge), or downloaded / ZIPped (Safari/Firefox), with an in-memory fallback when private storage is unavailable.
  - Progress, Cancel ("Cancelling safely…" → "Cancelled. Partial files were removed."), and the "Generation failed" dialog with details.
- Successful jobs are recorded in History (newest 20) and send the "Promo video finished" notification when enabled. Leaving the page during a job asks first, and the screen stays awake.
- Windowed-sinc resampler (output audio at 44.1 kHz, as on desktop) and `AudioLoop` port.
- Browsers without WebGL in Workers (WebKitGTK, older Safari) render with the bit-exact CPU effects instead, with a warning.

### Fixed
- Settings could overwrite a template typed before stored settings finished loading.

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
