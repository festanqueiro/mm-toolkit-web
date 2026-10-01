# Benchmarks

## Phase 0 spike — 60 s 1080×1920 @ 24 fps promo, bass-reactive blur (2026-10-02)

**Job**: 100 s 44.1 kHz stereo 16-bit WAV (generated, bass drop at 45 s) + a 1500×1500 PNG. The snippet runs from 40 s for 60 s, contain-fit onto the vertical canvas, with bass blur and video/audio fades → MP4 (1,440 frames).

**Machine**: Apple M1 Pro (10 cores), 16 GB, macOS 26.2.

**How**: `npm run bench` (Playwright 1.63, **headless**) drives `/spike.html` with "Generated test media". Desktop baseline: `core.generate_videos` from desktop v1.0.2 on an equivalent synthetic WAV/PNG (libx264, CRF 18, preset medium, AAC 320k).

| Runtime | Total | Render+encode throughput | Video | Audio | Output |
|---|---|---|---|---|---|
| **Desktop app** (moviepy + libx264 medium, CRF 18) | **33.4 s** | ~43 fps | H.264, ≈ 6.9 Mb/s | AAC 320k | 51.8 MB |
| Chrome 154 (headless) | **8.8 s** | 185 fps | H.264 High (`avc1.640028`), 5.9 Mb/s | AAC 312 kb/s | 46.8 MB |
| WebKit 26.6 / Safari engine (headless) | **8.0 s** | 197 fps | H.264 High, **3.0 Mb/s** ⚠️ | AAC **67 kb/s** ⚠️ | 22.9 MB |
| Firefox 155 (headless) | **10.2 s** | 148 fps | H.264 High, 5.9 Mb/s | **Opus** 390 kb/s, 48 kHz | 47.5 MB |
| Playwright Chromium 153 (open-source build) | 34.7 s | 42 fps | H.264 (likely software OpenH264) | AAC 312 kb/s | 42.7 MB |

Requested: video 0.12 bpp ("High") = 5.97 Mb/s, audio 320 kb/s. Decode + bass analysis took < 0.2 s in every browser. All outputs passed `ffmpeg -v error -f null -` (60.0 s, 1080×1920, 24 fps).

### Findings

1. **Feasible and fast.** Chrome, Safari and Firefox render the reference promo **3–4× faster than the desktop app**. Hardware WebCodecs + GPU effects remove the per-frame CPU work (NumPy/OpenCV + piping raw frames to FFmpeg). Spec 04's speed goal is met with room to spare.
2. **Open-source Chromium is ~4× slower than Chrome** (no proprietary hardware H.264 path). It's still on par with desktop. Ship no browser-specific code; capability detection already picks H.264.
3. **WebKit ignores the requested bitrates.** Video lands at ~50 % of target, and AAC at 67 kb/s regardless of the 320k request. Follow-ups:
   - Try `bitrateMode: "constant"` and the `quantizer` mode on WebKit.
   - If AAC stays capped, **route AAC to the WASM encoder on WebKit**. Detect this by measuring the encoded output, not by user-agent: e.g. a 1 s probe encode at startup that checks the achieved bitrate.
4. **Firefox has no AAC encoder** (as predicted): Opus is chosen automatically. Spec 04's fallback chain (WASM AAC → Opus with a warning) stands.
5. **Colour range**: open-source Chromium and WebKit tag the output **full range** (`yuvj420p`); Chrome and Firefox (and the desktop) use limited/TV range. Full range can look washed out or crushed on some platforms. Follow-up: set `colorSpace` (`fullRange: false`, BT.709) explicitly on the frames/encoder, then re-probe.
6. **Quality calibration (preliminary):** desktop CRF 18 averaged ≈ 6.9 Mb/s on this content, vs 5.9 Mb/s for "High" at 0.12 bpp. **Raise "High" to ≈ 0.14 bpp** as a starting point. A proper visual comparison (VMAF/SSIM on identical frames) is still pending: the spike's envelope and resampling aren't the parity versions yet, so the frames aren't identical.
7. Headless numbers are a **lower bound** for GPU/hardware paths. For real-world numbers, open `/spike.html` in a normal browser window (it's deployed with the app) and paste the JSON result here.

### Raw results

Per-browser JSON: `test-results/bench/*.json` (not committed). Re-run with `npm run bench` (`--project=chrome|chromium|webkit|firefox`).
