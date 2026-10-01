# Running MM Toolkit in the Browser — Feasibility Analysis

**Question:** Can MM Toolkit run entirely in a web browser, with **all processing client-side** (no server doing media work)? What would it cost, and what would we lose?

**Short answer:** **Yes, with caveats.** Every tool can run client-side in a modern desktop browser. But it is a **rewrite**, not a port. The Python/Qt stack can't run in a browser as-is. FFmpeg-via-`subprocess` has to be replaced by browser media APIs (WebCodecs) and/or FFmpeg compiled to WebAssembly. What you get depends heavily on the browser:

| | Chrome / Edge (desktop) | Safari (macOS) | Firefox (desktop) | Mobile (iOS / Android) |
|---|---|---|---|---|
| Overall | ✅ Near-full parity | ⚠️ Works; no folder output, more codec gaps | ⚠️ Works; no folder output, more codec gaps | ⚠️ Small jobs only (memory, backgrounding) |

The biggest losses are **file-system UX** (no "export to folder" outside Chromium, no "open the output file", History can't re-open past paths), **long jobs tied to an open tab**, and **slower encoding wherever we fall back to `ffmpeg.wasm`**. The biggest win: the **Video Creator effects can run on the GPU**, which allows a **live, real-time preview**. The desktop app doesn't have that today.

---

## 1. What the app depends on today

| Layer | Dependency | Used for | Runs in a browser? |
|---|---|---|---|
| UI | PySide6 (Qt 6) | All windows, tabs, dialogs, `QMediaPlayer` previews, `QSettings`, tray notifications | ❌ No supported PySide6 for WebAssembly. Qt for WASM exists for C++ Qt only. **The UI must be rebuilt in HTML/JS.** |
| Media I/O | FFmpeg binary via `subprocess` (`require_ffmpeg`, `_normalise_audio`, `_extract_audio`, `cut_media_clips`, `convert_media`) | Decode/encode/trim every format | ❌ No `subprocess` in a browser. Replace with **WebCodecs** + a JS muxer, and/or **ffmpeg.wasm** |
| Render pipeline | moviepy 2 (`VideoClip`, `AudioFileClip`, fades, `write_videofile`) | Frame generation + encoding to H.264/AAC MP4 | ❌ moviepy pipes frames to an FFmpeg subprocess. Re-implement the frame loop in JS |
| DSP | scipy `butter` + `sosfiltfilt`, numpy | Drop detection, bass envelope | ✅ Small, easy to port to JS (or run in Pyodide) |
| Imaging | OpenCV (`resize`, `warpAffine`, `split/merge`, `addWeighted`), Pillow (`LANCZOS`, `ImageOps.fit/contain`) | Effects cascade, fit/letterbox | ✅ Better done in WebGL/WebGPU shaders or Canvas 2D |
| Audio read | `soundfile` (libsndfile) | Read normalised WAV | ✅ Replace with `decodeAudioData` / WebCodecs `AudioDecoder` |
| Network | `QNetworkAccessManager` → GitHub Releases API | Update check | ✅ `fetch()` works (api.github.com sends CORS headers), but the check isn't needed for a web app |
| Persistence | `QSettings` | Settings, effect state, history (20 jobs) | ✅ `localStorage` / IndexedDB |
| OS integration | `QFileDialog` (files + directories), `QDesktopServices.openUrl`, `QSystemTrayIcon` | Pick inputs/output folder, open results, notifications | ⚠️ Partially. See §4 |

---

## 2. Two architectural options

### Option A — Native web rewrite (TypeScript) — **recommended**

- **UI:** any SPA framework (or plain TS + Web Components). Hosted as static files.
- **Media engine:**
  - **WebCodecs** (`VideoEncoder`/`VideoDecoder`/`AudioEncoder`/`AudioDecoder`) for hardware-accelerated decode/encode.
  - A JS container library for demux/mux, e.g. **Mediabunny** (successor to `mp4-muxer`/`webm-muxer`; reads and writes MP4/MOV/WebM/MKV/WAV/MP3/Ogg and more). WebCodecs only handles raw frames and packets, not containers.
  - **ffmpeg.wasm** as a lazy-loaded fallback for what WebCodecs can't do: MP3/FLAC/Vorbis encode, AVI, AIFF decode in Chromium/Firefox, odd inputs.
- **Effects:** WebGL2 (or WebGPU) fragment shaders, run in a **Web Worker** with **OffscreenCanvas**.
- **DSP:** ~100 lines of TypeScript (biquad cascade + forward/backward filtering + RMS bins).

### Option B — Reuse Python via Pyodide

Pyodide (CPython on WASM) ships `numpy`, `scipy`, `Pillow` and `opencv-python`, so `detect_drop_time`, `_build_bass_envelope` and all of `effects.py` *could* run unmodified. However:

- **`soundfile`, `moviepy`, `subprocess`, `imageio-ffmpeg` and PySide6 don't work.** Every FFmpeg call and the whole UI still have to be rewritten in JS. Only the math moves over.
- **Per-frame cost:** each 1080×1920 RGB frame is ~6 MB. It would cross the JS↔Python boundary every frame, and numpy/OpenCV in WASM run without native SIMD/threading. Expect to be several times slower than the desktop app, which is already "compute-heavy" (README).
- **Download weight:** Pyodide + scipy + OpenCV is tens of MB before the first frame.

**Verdict:** Option B saves little effort (the DSP and effects are the *easy* part) and gives the slowest result. Use it only as a short-lived prototype, or as a reference oracle to validate the JS port against.

---

## 3. Tool-by-tool analysis

Legend: ✅ works as today · ⚠️ works with limitations/changes · ❌ not possible client-side

### 3.1 Video Creator (`video_creator.py`, `core.render_track`, `effects.py`)

The heaviest tool, and the one where the browser can actually *improve* things.

| Feature | Today | Browser approach | Status |
|---|---|---|---|
| Pick audio file(s) or a whole folder | `QFileDialog` file/dir | `<input type="file" multiple>`, `<input webkitdirectory>` (all major browsers), drag & drop, `showDirectoryPicker()` (Chromium) | ✅ |
| Audio formats: wav, aif/aiff, flac, mp3, m4a, aac, ogg | FFmpeg normalises to 16-bit stereo WAV | `decodeAudioData` / `AudioDecoder`. Support differs by browser: **AIFF only decodes natively in Safari**; Ogg/Vorbis has historically been weak in Safari. Fallback: ffmpeg.wasm → PCM | ⚠️ All formats work, some via a slower fallback |
| Per-track preview playback (start + duration) | `QMediaPlayer` | `<audio>` element + `currentTime`, or `AudioBufferSourceNode.start(0, offset, duration)` (sample-accurate, works for every decoded format) | ✅ (better) |
| Drop detection (`detect_drop_time`) | scipy 4th-order Butterworth LP @150 Hz, zero-phase `sosfiltfilt`, 0.5 s RMS bins, 8 s before/after scan | Port to TS: two biquad sections run forward then backward over the `Float32Array`. Milliseconds-to-~1 s for a full track. Run in a Worker | ✅ Results should match Python within a bin (0.5 s). Validate with golden files. Note: `decodeAudioData` **resamples to the context rate**. Use `OfflineAudioContext({sampleRate: <file rate>})` or `AudioDecoder` to keep the native rate (bin maths are rate-independent, so this is mostly about precision) |
| Bass envelope (`_build_bass_envelope`) | Same filter, RMS per frame, normalise, `^1.6` | Same port | ✅ |
| Image visual (png/jpg/webp/tif) | Pillow | `createImageBitmap()`. **TIFF isn't decodable** in Chrome/Firefox (Safari only) → needs a JS TIFF decoder (e.g. `utif`) | ⚠️ TIFF needs a library |
| Video visual (looped, `get_frame(t % dur)`) | moviepy/FFmpeg | Demux with Mediabunny + `VideoDecoder`, decode sequentially and loop. **Avoid `<video>` seeking per frame** (slow and inexact). MKV/AVI/some MOV codecs (ProRes) won't decode via WebCodecs → ffmpeg.wasm transcode first | ⚠️ H.264/VP9/AV1/HEVC* sources fine; ProRes/AVI/exotic need a slow pre-transcode |
| Mix original video audio (looped) | `AudioLoop` + `CompositeAudioClip` | `OfflineAudioContext` with a looping `AudioBufferSourceNode` + the music source | ✅ |
| Audio/video fades | moviepy `AudioFadeIn/Out`, `FadeIn/Out` | `GainNode.linearRampToValueAtTime`; shader/`globalAlpha` multiplier on the frame | ✅ |
| Output sizes: native / 1080×1920 / 1080×1080 / 1920×1080, letterbox on background | Pillow `contain` + paste | Canvas/shader. **Lanczos** isn't built into canvas. `imageSmoothingQuality="high"` is close, or use `pica` for true Lanczos on the one-off still | ✅ (tiny resampling differences) |
| Background: solid colour or image (`ImageOps.fit`) | Pillow | Canvas cover-fit | ✅ |
| Overlay image (alpha, opacity) | numpy alpha composite | Shader / `globalAlpha` + `drawImage` | ✅ |
| Bass-reactive radial blur (6 zoomed copies averaged) | 6× `cv2.resize` per frame | One fragment shader with 6 texture taps: **trivially real-time on GPU** | ✅ (much faster) |
| Rotate (rpm/120, clockwise, background revealed, anti-aliased edge) | `cv2.warpAffine` ×2 | Shader rotation of UVs with an edge coverage mask | ✅ |
| VHS (chroma shift, scanlines, seeded noise, dry/wet) | numpy, `default_rng(int(time*1000))` | Shader with a hash-based noise seeded by frame time | ✅ Looks the same but **not bit-identical**: numpy's PCG64 stream won't be reproduced. Fine for a visual effect |
| Glitch (random slice shifts + red split) | numpy RNG per frame | Small seeded PRNG in JS (e.g. mulberry32) builds a slice table → shader uniform/texture | ✅ Same caveat |
| Drag-to-reorder cascade | `QListWidget` InternalMove | HTML drag & drop / SortableJS; order → shader pass sequence | ✅ |
| **Live preview of effects** | ❌ Not available (render to see) | Same shader pipeline driven by `requestAnimationFrame` + live bass envelope | ✅ **New capability** |
| Encode H.264 (`libx264`, preset, CRF 14–30, yuv420p) + AAC 320k → MP4 | moviepy → FFmpeg | **WebCodecs `VideoEncoder`** (`avc1.640028`), usually hardware-accelerated → Mediabunny MP4 mux | ⚠️ See notes below |
| fps 12–60, duration up to 600 s / track | | | ✅ |
| Batch: many tracks → many MP4s, naming template, conflict policy | Writes to output folder | See §4 (file output) | ⚠️ |
| Progress + cancel | `QThread` signals, `should_cancel` | Worker `postMessage` progress; `AbortController`/flag between frames | ✅ |

**Encoding notes (Video Creator):**

- **No CRF or x264 presets in WebCodecs.** It offers `bitrate` + `bitrateMode` (`constant`/`variable`, and `quantizer` with per-frame QP in Chromium), plus `latencyMode: "quality"`. The CRF spinner and "Encoding speed" (ultrafast…slow) need to become a **quality preset that maps to bitrate/QP**. Output quality and size won't match today's x264 renders exactly. Hardware H.264 encoders are generally a bit less efficient than x264 `medium` at the same size.
- **AAC encoding via `AudioEncoder` isn't available in every browser.** Chromium supports it on the major desktop OSes, and Firefox has historically lacked it. Fallbacks: Opus-in-MP4 (less universally accepted by social platforms), or encode **just the audio** with ffmpeg.wasm's AAC encoder (cheap, because audio is small).
- **Hardware vs. ffmpeg.wasm speed.** With hardware WebCodecs, a 60 s 1080×1920@24 fps promo (1,440 frames) should take seconds to tens of seconds, competitive with or faster than the desktop app. Encoding the same with **ffmpeg.wasm `libx264` is roughly an order of magnitude slower than native FFmpeg** (single-threaded, no SIMD by default). Expect many minutes per video. WebCodecs must be the primary path for video.
- **Memory.** Stream frames encoder → muxer → `FileSystemWritableFileStream` (or OPFS), so the whole MP4 never sits in RAM. Without a streaming target (Firefox/Safari download path), the finished file is held as a `Blob`. That's fine for promos (tens of MB).

### 3.2 Media Cutter (`clips_tab.py`, `core.cut_media_clips`)

| Feature | Today | Browser approach | Status |
|---|---|---|---|
| Load audio or video source | `QFileDialog` | File input / drag & drop | ✅ |
| Playback preview with seek bar, set start/end from playhead | `QMediaPlayer` + `QVideoWidget` | `<video>`/`<audio>` element. **Playable formats depend on the browser**: MKV and AVI don't play natively anywhere (Chrome plays some MKV/WebM); AIFF only in Safari | ⚠️ For unplayable sources, show a decoded waveform (Web Audio) + WebCodecs frame thumbnails instead of native playback, or offer a one-off ffmpeg.wasm transcode to a preview proxy |
| Per-clip preview (play start→end) | `QMediaPlayer` + position watch | Same, with `timeupdate`/rAF stop. For audio, `AudioBufferSourceNode.start(0, start, dur)` is sample-accurate | ✅ |
| Timestamp parsing (HH:MM:SS, MM:SS, s), end-or-duration | `parse_timestamp` | Trivial TS port | ✅ |
| **Video clip** → H.264/AAC MP4, CRF 18, `+faststart`, re-encoded (frame-accurate) | FFmpeg `-ss` + re-encode | Mediabunny `Conversion` with a trim range → WebCodecs re-encode (frame-accurate, hardware). `+faststart` is available as a muxer option (`fastStart`) | ⚠️ Same CRF→bitrate caveat as above; non-WebCodecs sources (AVI/ProRes) need ffmpeg.wasm |
| **Audio clip, same format as source** (mp3 320k, wav 24-bit, aiff 24-bit BE, flac, m4a/aac 320k, ogg q8) | FFmpeg | WAV/AIFF: write PCM headers in JS (trivial, instant). AAC/Opus: WebCodecs where supported. **MP3, FLAC, Vorbis: no WebCodecs encoder** → `lamejs`/`libflac.js` or ffmpeg.wasm (audio-only ffmpeg.wasm is fast enough; audio is cheap) | ⚠️ All formats work; MP3/FLAC/OGG via WASM |
| Optional: lossless "stream copy" cuts | Not offered | Possible with Mediabunny (packet copy, keyframe-aligned for video; exact for most audio) | Opportunity |
| Batch of titled clips, naming template, conflicts | Output folder | §4 | ⚠️ |

### 3.3 Media Converter (`converter_tab.py`, `core.convert_media`)

This tool exercises the widest codec matrix, so it hits the most gaps.

| Output | Today's encoder | Browser path | Status |
|---|---|---|---|
| **mp4 / mov / mkv** (H.264 + AAC) | libx264 CRF 18 fast + AAC 256k | WebCodecs H.264 + AAC (or Opus fallback) → Mediabunny MP4/MOV/MKV | ⚠️ Fast; quality is bitrate-mapped, AAC availability varies |
| **webm** (VP9 CRF 28 + Opus 192k) | libvpx-vp9 + libopus | WebCodecs VP9 + Opus → WebM. Opus encode is broadly supported. VP9 encode is often **software** in browsers, so slower than H.264 but still WebCodecs speed | ✅ |
| **avi** (MPEG-4 Part 2 + MP3) | `mpeg4` + libmp3lame | **No WebCodecs encoder for MPEG-4 Part 2 and no common JS AVI muxer** → ffmpeg.wasm only (slow for long videos) | ⚠️ Works, slow. Consider dropping AVI as an output |
| **wav / aiff** (24-bit PCM) | pcm_s24le / be | Decode → write PCM in JS | ✅ Instant |
| **flac** | flac | ffmpeg.wasm or `libflac.js` | ✅ (WASM) |
| **mp3** (128–320k) | libmp3lame | ffmpeg.wasm or `lamejs` | ✅ (WASM/JS) |
| **m4a / aac** (256k) | aac | WebCodecs `AudioEncoder` where available, else ffmpeg.wasm | ⚠️ browser-dependent path |
| **ogg** (Vorbis q6) | libvorbis | ffmpeg.wasm (WebCodecs only *decodes* Vorbis), or switch output to Ogg **Opus** via WebCodecs | ⚠️ WASM, or change codec |
| Input: any of mp4/mov/m4v/mkv/avi/webm, wav/aif/flac/mp3/m4a/aac/ogg | FFmpeg decodes anything | Mediabunny demux + WebCodecs decode for common codecs. AVI/AIFF/ProRes/legacy codecs → ffmpeg.wasm | ⚠️ |
| Batch + progress + cancel | | Workers; process files sequentially to cap memory | ✅ |
| Mixed audio/video selection rejected | | Same validation | ✅ |

**Converter-specific limits:**

- **File size ceiling on the ffmpeg.wasm path.** ffmpeg.wasm is 32-bit WASM (≤ 4 GB address space, in practice ~2 GB usable). By default it copies the input into an in-memory FS (`MEMFS`) and builds the output there too. **Inputs over roughly 1–2 GB will fail** on the WASM path. Mounting the input with `WORKERFS` avoids one copy. The WebCodecs + Mediabunny path streams and has no such ceiling.
- **Threads need cross-origin isolation.** Multithreaded ffmpeg.wasm (`@ffmpeg/core-mt`) needs `SharedArrayBuffer`, which needs the page served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`). See §5.

### 3.4 History (`history_tab.py`)

| Feature | Today | Browser | Status |
|---|---|---|---|
| Store last 20 jobs (settings, outputs) | `QSettings` JSON | `localStorage`/IndexedDB | ✅ |
| Preview an output in-app | `QMediaPlayer` | Only if we still hold the file: an OPFS copy, or a `FileSystemFileHandle` persisted in IndexedDB (Chromium) | ⚠️ |
| **"Open" output in the OS** | `QDesktopServices.openUrl(file)` | ❌ A web page can't open a local file in Finder/Explorer or a native player. Best effort: re-download, or open a `blob:` URL in a new tab | ❌ → replace |
| **"Load job" back into a tab** | Re-uses absolute source paths | Paths are meaningless in a browser. Chromium can persist **file handles** in IndexedDB and re-request permission. Firefox/Safari require **re-picking the source files** | ⚠️ Settings restore fine; sources must be re-selected outside Chromium |
| Unread badge on tab | Qt tab text/icon | DOM badge; also `navigator.setAppBadge()` for an installed PWA | ✅ |

### 3.5 Settings (`settings_tab.py`)

| Setting | Browser | Status |
|---|---|---|
| Default export folder | Chromium: `showDirectoryPicker()` handle stored in IndexedDB. Permission is re-confirmed per session unless the user grants "Allow on every visit" (persistent permissions, Chrome 122+). **Firefox/Safari: no writable directory access**, so files go to the browser's Downloads folder | ⚠️ Chromium only |
| Filename templates (`{track}`, `{number}`, `{source}`, `{title}`) | Same logic; `safe_filename` port | ✅ |
| Existing files: rename / skip / overwrite | Implementable against a directory handle (`getFileHandle` without `create` to probe existence). **Not possible with plain downloads**: the browser decides naming (`file (1).mp4`) | ⚠️ Chromium only |
| Notifications on finish | Notifications API (needs a permission prompt; won't fire after the tab is closed) replacing the tray | ✅ |

### 3.6 About / update check (`about_tab.py`, `versioning.py`)

- `fetch("https://api.github.com/repos/…/releases/latest")` works from the browser (CORS allowed; unauthenticated limit is 60 req/h per IP).
- **It isn't needed.** A static web app is always the deployed version. Replace the check with a **service-worker "new version available — reload"** prompt if the app is made offline-capable (PWA).
- `__version__` stays the single source of truth: inject it at build time and show it in About.
- `dev_build_label()` (git subprocess) → inject the commit hash at build time.

---

## 4. Cross-cutting limitations

### 4.1 File system (the biggest UX change)

| Capability | Chrome/Edge | Safari | Firefox |
|---|---|---|---|
| Pick files / folder to **read** | ✅ | ✅ (`webkitdirectory`) | ✅ (`webkitdirectory`) |
| Drag & drop files in | ✅ | ✅ | ✅ |
| **Write into a user-chosen folder** (`showDirectoryPicker`, `FileSystemWritableFileStream`) | ✅ | ❌ | ❌ |
| Remember that folder across sessions | ✅ (handle in IndexedDB + permission) | ❌ | ❌ |
| Private scratch storage (OPFS) | ✅ | ✅ | ✅ |
| Fallback for output | — | Download each file, or bundle a batch as a **ZIP** (`client-zip`/`fflate`, streamed) | same |

Consequences: outside Chromium, "Default Folder for Export" and the conflict policy disappear, and batch exports become many downloads or one ZIP.

### 4.2 Long-running jobs live and die with the tab

- Closing or reloading the tab **kills the job**. No background daemon is possible: Service Workers can't run arbitrary long CPU work, and Background Fetch is for network requests only.
- Background tabs get **timer throttling**. Render in a **dedicated Worker** (WebCodecs and OffscreenCanvas both work in Workers), which isn't throttled like the main thread. Add a `beforeunload` warning while a job runs.
- **Mobile**: iOS/Android suspend backgrounded tabs within seconds to minutes. Treat mobile as "keep the screen on, small jobs".
- Optional: Screen Wake Lock API to stop the device sleeping mid-render.

### 4.3 Memory

- Desktop browsers typically allow a few GB per tab. Mobile Safari kills tabs far earlier.
- Fully decoded audio is large: a 7-minute 48 kHz stereo track is ~160 MB as Float32. Fine for a few tracks; **process a batch sequentially and release buffers**.
- Never hold all video frames. Stream decode → effect → encode → mux → disk.
- The ffmpeg.wasm path has the hard ~2 GB ceiling described in §3.3.

### 4.4 Codec and format support varies by browser

WebCodecs ships in Chromium (since 94), Safari (video since 16.4, audio later) and Firefox desktop (since 130). **Encoders/decoders available inside WebCodecs depend on browser and OS.** Feature-detect at runtime with `VideoEncoder.isConfigSupported()` / `AudioEncoder.isConfigSupported()` and route to the WASM fallback, rather than hard-coding a matrix. Typical gaps to plan for:

- **Encode-side:** no MP3, FLAC or Vorbis encoders in any browser; AAC encode is missing in some (notably Firefox); no MPEG-4 Part 2 (AVI).
- **Decode-side:** AIFF and TIFF decode natively only in Safari; ProRes and other pro codecs aren't decodable; HEVC depends on OS/hardware.
- **Native playback (`<video>`/`<audio>`):** MKV/AVI generally unplayable; Ogg spotty in Safari.

### 4.5 Output parity with the desktop app

- **Not bit-identical.** Different resamplers (Lanczos vs. canvas/GPU), different RNG streams for VHS/Glitch, and a different H.264 encoder (hardware vs. x264). Visually equivalent, numerically different.
- Drop detection *can* be numerically very close (pure maths). Port `tests/test_core.py` drop/envelope cases to the JS test suite with **golden values generated by the Python implementation** to prove it.

### 4.6 Licensing

- The **ffmpeg.wasm core with `libx264` is GPL**. Serving that `.wasm` to users is distribution, with GPL source-offer obligations, similar to today's bundled `imageio-ffmpeg` build. An **LGPL ffmpeg.wasm build without x264** (H.264 encode handled by WebCodecs instead) avoids the GPL obligations.
- **H.264/AAC patent licensing** for WebCodecs encoders is covered by the browser/OS vendor, an advantage over shipping your own encoder.

---

## 5. Hosting (still zero server-side processing)

The app is just static files (HTML/JS/WASM). Any static host works. Media never leaves the user's machine.

- **Cross-origin isolation** is needed only for multithreaded ffmpeg.wasm (`SharedArrayBuffer`):
  - Netlify / Cloudflare Pages / Vercel: set `COOP`/`COEP` headers via config (`_headers`).
  - **GitHub Pages can't set custom headers.** Use a `coi-serviceworker` shim, single-threaded ffmpeg.wasm only, or a different host.
  - `COEP: require-corp` blocks cross-origin assets (fonts, CDN scripts) without CORP headers. **Self-host all assets**, or use `COEP: credentialless` (Chromium/Firefox).
- **Lazy-load ffmpeg.wasm** (~30 MB core) only when a job needs it. The WebCodecs path needs no large download.
- **PWA (optional):** a service worker caches the app and WASM, so it works offline, can be "installed", and gets an app badge and File Handling API (Chromium: "Open with MM Toolkit").

---

## 6. Feature parity summary

| Tool / feature | Chromium desktop | Safari desktop | Firefox desktop |
|---|---|---|---|
| Video Creator: drop detection, envelope, all effects | ✅ | ✅ | ✅ |
| Video Creator: live effect preview (new) | ✅ | ✅ | ✅ |
| Video Creator: H.264 MP4 encode (hardware) | ✅ | ✅ | ✅ |
| Video Creator: AAC audio track | ✅ | ✅ | ⚠️ WASM fallback / Opus |
| Video Creator: video-as-visual (common codecs) | ✅ | ✅ | ✅ |
| Media Cutter: preview playback | ✅ (most formats) | ⚠️ | ⚠️ |
| Media Cutter: frame-accurate video clips | ✅ | ✅ | ✅ |
| Media Cutter: mp3/flac/ogg clip output | ⚠️ WASM | ⚠️ WASM | ⚠️ WASM |
| Converter: mp4/mov/mkv/webm | ✅ | ⚠️ | ⚠️ |
| Converter: avi | ⚠️ WASM, slow | ⚠️ WASM, slow | ⚠️ WASM, slow |
| Converter: wav/aiff | ✅ | ✅ | ✅ |
| Converter: mp3/flac/ogg/m4a | ⚠️ WASM for most | ⚠️ | ⚠️ |
| Converter: files > ~2 GB | ✅ WebCodecs path / ❌ WASM path | same | same |
| Export to chosen folder + conflict policy | ✅ | ❌ (downloads/ZIP) | ❌ (downloads/ZIP) |
| History: reload job with sources | ✅ (persisted handles) | ⚠️ re-pick files | ⚠️ re-pick files |
| History: open output in OS | ❌ | ❌ | ❌ |
| Finish notifications | ✅ | ✅ | ✅ |
| Jobs survive closing the tab | ❌ | ❌ | ❌ |

---

## 7. Recommendation and suggested path

1. **Rewrite as a TypeScript static web app (Option A).** Treat `core.py`/`effects.py` as the spec and the Python test suite as the oracle.
2. **Use WebCodecs + Mediabunny as the primary media path**, with **ffmpeg.wasm lazy-loaded only for gaps** (MP3/FLAC/Vorbis encode, AVI, AIFF/exotic decode). Feature-detect per browser at runtime.
3. **Port in order of value vs. risk:**
   1. Drop detection + bass envelope (pure maths; golden-test against Python).
   2. Video Creator effects as WebGL shaders + **live preview** (the most visible win).
   3. Video Creator H.264 export (WebCodecs) with an AAC→fallback chain.
   4. Media Cutter (Mediabunny trim; PCM formats in JS; WASM for MP3/FLAC/OGG).
   5. Media Converter (widest matrix; consider dropping AVI output and switching OGG output to Opus).
   6. Settings/History on IndexedDB; File System Access with ZIP/download fallback.
4. **Replace CRF + x264 presets** with a quality preset (e.g. Draft / Standard / High) mapped to bitrate/QP, and document that output differs from desktop renders.
5. **Target Chromium desktop first.** It's the only engine with full folder-export UX. Support Safari/Firefox with the download/ZIP path, and label mobile as "best effort".
6. **Keep the desktop app** if users depend on very large files, unattended batch runs, or exact x264 output. The browser version complements it rather than replacing it for those cases.

**Benchmark before committing.** The speed claims here (hardware WebCodecs ≫ ffmpeg.wasm; ffmpeg.wasm roughly an order of magnitude slower than native) are general expectations, not measurements on this codebase. A one-day spike that renders a 60 s 1080×1920 promo with radial blur via WebGL + WebCodecs in Chrome, Safari and Firefox would settle the numbers.
