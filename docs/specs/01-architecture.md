# 01 — Architecture

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | **TypeScript** (`strict`) | |
| Build / dev server | **Vite** | Same as the author's other web projects |
| Unit tests | **Vitest** | Golden-fixture parity tests ([12](12-testing-and-parity.md)) |
| E2E tests | **Playwright** (Chromium, WebKit, Firefox) | Exercises the Tier 1/2 matrix |
| UI framework | **Svelte 5** (ADR-001, decided 2026-10-02) | Small runtime, good fit for form-heavy tabs |
| Media container I/O | **Mediabunny** | Demux/mux MP4, MOV, WebM, MKV, WAV, MP3, Ogg, ADTS, FLAC; drives WebCodecs. Verify the format list against the current release |
| Codecs (primary) | **WebCodecs** | `VideoEncoder`/`VideoDecoder`/`AudioEncoder`/`AudioDecoder` |
| Codecs (fallback) | **ffmpeg.wasm** (`@ffmpeg/ffmpeg`), lazy-loaded | MP3/FLAC/Vorbis encode, AVI, AIFF/exotic decode, MPEG-4 Part 2. Prefer an **LGPL build without x264** (see Licensing) |
| Effects rendering | **WebGL2** on **OffscreenCanvas** in a Worker | WebGPU is a later optimisation, not required |
| ZIP for batch download | `client-zip` or `fflate` (streaming) | Tier 2 export path |
| Lint / types | ESLint (typescript-eslint, eslint-plugin-svelte) + `svelte-check` | TypeScript pinned to 6.x until svelte-check supports 7 |
| Commit linting | commitlint + husky (Conventional Commits) | Mirrors the desktop repo policy |

## Layering (mirrors the desktop's two-layer split)

The desktop repo enforces **`core.py` (pure engine, no Qt) vs. `ui/` (Qt)**. Keep the same discipline:

```
src/
  engine/                 # pure TS, no DOM-main-thread APIs; runs in Workers; fully unit-tested
    time.ts               # parseTimestamp, formatTimestamp (port of core.py helpers)
    naming.ts             # safeFilename, template formatting, resolveOutput
    media-kind.ts         # extension tables, mediaKind()
    analysis/
      filters.ts          # Butterworth design + zero-phase SOS filtering
      drop.ts             # detectDropTime, detectDropStarts
      envelope.ts         # buildBassEnvelope
    effects/
      settings.ts         # EffectSettings & friends (port of effects.py dataclasses)
      chain.ts            # applyEffectChain orchestration (order, enable flags)
      gl/                 # WebGL2 programs: radialBlur, rotate, vhs, glitch, overlay, fit
      cpu/                # reference CPU implementations (used by tests & as a fallback)
    media/
      capabilities.ts     # runtime codec/feature detection
      decode-audio.ts     # file → Float32 PCM at native rate (WebCodecs or WASM)
      encode-audio.ts     # PCM → mp3/flac/ogg/aac/opus/wav/aiff (routes per capability)
      video-source.ts     # looped frame source for video visuals
      mux.ts              # Mediabunny wrappers
      ffmpeg.ts           # lazy ffmpeg.wasm loader + job runner
    jobs/
      render-promo.ts     # Video Creator pipeline (port of core.render_track / generate_videos)
      cut-clips.ts        # port of core.cut_media_clips
      convert.ts          # port of core.convert_media
      progress.ts         # ProgressCallback / cancellation primitives
  workers/
    job.worker.ts         # hosts engine/jobs/*; one job at a time per worker
  io/                     # File System Access, OPFS, downloads, ZIP, handle persistence
  storage/                # settings + history persistence (IndexedDB/localStorage)
  ui/                     # one module per tab + shared components (see 09)
```

Rules:

1. **`engine/` never touches `document`/`window` UI APIs.** It may use APIs available in Workers (WebCodecs, OffscreenCanvas, OPFS, `fetch` for the ffmpeg core).
2. **Long work never runs on the main thread.** This is the equivalent of the desktop rule "never call `core.py`'s FFmpeg/moviepy functions from a UI callback". Every job runs in `job.worker.ts` and talks to the UI with typed messages.
3. **UI follows the OS light/dark theme** via CSS `prefers-color-scheme` + tokens. This mirrors the desktop's `palette(...)` stylesheet rule. No hardcoded colours in components.

## Worker protocol

Typed messages, the web equivalent of the desktop's Qt signals:

| Desktop signal | Worker message |
|---|---|
| `progress(int percent, str status)` | `{type: "progress", percent: 0..100, status: string}` |
| `succeeded(list outputs)` | `{type: "succeeded", outputs: OutputRef[]}` |
| `failed(str message, str details)` | `{type: "failed", message, details}` |
| `cancelled()` | `{type: "cancelled"}` |
| `requestInterruption()` | UI → worker `{type: "cancel"}`; engine checks `shouldCancel()` between frames, files and chunks |

Cancellation semantics match desktop: **partial outputs are deleted**. The UI status then reads "Cancelled. Partial files were removed." (Converter: "Conversion cancelled. Partial files were removed.").

## Capability detection

`engine/media/capabilities.ts` runs once at startup and caches a `Capabilities` object:

- `VideoEncoder.isConfigSupported()` for `avc1.640028` (H.264 High 4.0, ≤1080p), `vp09.00.10.08`, `av01.0.04M.08`.
- `AudioEncoder.isConfigSupported()` for `mp4a.40.2` (AAC-LC) at the requested bitrate, and `opus`.
- `VideoDecoder`/`AudioDecoder` support for the codecs found in a specific input. Checked per file after demux.
- `'showDirectoryPicker' in window`, `navigator.storage.getDirectory` (OPFS), `OffscreenCanvas`, WebGL2, `crossOriginIsolated` (multi-threaded ffmpeg.wasm), Notifications, Wake Lock.

Each encode or decode is routed through a single decision function. For example, `chooseAudioEncoder(format, bitrate) → "webcodecs" | "wasm"`. Routing never depends on the browser's name.

## Codec routing table (initial)

| Need | Primary | Fallback |
|---|---|---|
| H.264 encode | WebCodecs | ffmpeg.wasm `libx264` (GPL build only; slow). Otherwise the job is unsupported |
| VP9 encode (webm) | WebCodecs | ffmpeg.wasm `libvpx-vp9` |
| MPEG-4 Part 2 encode (avi) | — | ffmpeg.wasm `mpeg4` |
| AAC encode | WebCodecs | `@mediabunny/aac-encoder` (WASM) |
| Opus encode | WebCodecs | ffmpeg.wasm `libopus` |
| MP3 encode | `@mediabunny/mp3-encoder` (LAME, WASM) | — |
| FLAC encode | `@mediabunny/flac-encoder` (WASM) | — |
| Vorbis encode | ffmpeg.wasm `libvorbis` (not shipped; Media Cutter uses Opus in Ogg until ADR-003) | — |
| WAV/AIFF 16/24-bit PCM | Pure TS writer | — |
| Audio decode | WebCodecs via Mediabunny; WAV/AIFF parsed in TS; FLAC decoded in TS (WebKit's WebCodecs FLAC fails at runtime) | ffmpeg.wasm → PCM |
| Video decode | WebCodecs via Mediabunny | ffmpeg.wasm transcode to an intermediate (ProRes, AVI, …) |
| Image decode | `createImageBitmap` | TIFF via `utif` (only Safari decodes TIFF natively) |

Mediabunny's WASM encoders are registered with `canEncodeAudio` checks, lazily, inside the job Worker. **A worker's entry module must statically import nothing**: it keeps only its message state and dynamic-`import()`s the logic (`job.worker.ts` → `job-host.ts`). Otherwise the bundler puts shared code (Mediabunny, `CancelledError`) in the entry, lazy chunks import it back, and WebKit evaluates the entry as a second module instance: WASM encoders registered in one copy are invisible to the other, and the second `onmessage` swallows Cancel. `e2e/build.spec.ts` asserts no chunk imports the entry.

Ask the browser directly (`AudioEncoder.isConfigSupported`) when deciding whether to register a fallback: Mediabunny's `canEncodeAudio` **memoizes per config**, so asking it before registering caches "unsupported" for that config even after the fallback exists.

## Memory and streaming rules

- **Never hold all video frames.** Use a streaming chain: decode → effect → encode → mux → sink.
- The sink is a `FileSystemWritableFileStream` (Tier 1, user folder), or an **OPFS file** (all tiers) that is then offered as a download or zipped.
- Process batch items **sequentially**, releasing decoded PCM and frames between items. Desktop also processes sequentially.
- ffmpeg.wasm: mount inputs with `WORKERFS` where possible. Refuse inputs over a configurable ceiling (default 1.5 GB) with a clear message instead of crashing.

## Licensing

- The desktop app ships `imageio-ffmpeg` (a GPL FFmpeg build). For the web, **prefer an LGPL ffmpeg.wasm build without x264**, because H.264 encoding is covered by WebCodecs. If a GPL core is ever served, the repo must meet GPL source-offer obligations.
- Material Icons: Apache-2.0 (see `assets/material-icons/NOTICE.md`). Keep the credit in About.
- H.264/AAC patent licensing for WebCodecs is the browser or OS vendor's.
