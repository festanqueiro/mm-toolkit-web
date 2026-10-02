# 12 — Testing & Parity

## Golden fixtures (the oracle)

`fixtures/golden/` was produced by `scripts/generate_golden.py` running the **real desktop engine** (v1.0.2, commit `a0c8576`; OpenCV 5.0.0, Pillow 11.3.0, numpy 2.5.2, scipy 1.18.0, recorded in `generatedFrom`). See `fixtures/golden/README.md`.

| Section of `golden.json` | Covers | Assertion |
|---|---|---|
| `pure.parseTimestamp` | valid & invalid inputs, exact error strings | exact |
| `pure.formatTimestamp` | incl. banker's-rounding cases | exact |
| `pure.safeFilename`, `pure.resolveOutput`, `pure.mediaKind`, extension/format lists | | exact |
| `pure.versionTuple`, `pure.isNewerVersion` | | exact |
| `pure.artworkCanvas` | even-dimension crop, letterbox canvas shape | exact shape |
| `audio.tracks[].detectDropTime` | 3 synthetic tracks (mono/stereo, short-track quirk) | exact |
| `audio.tracks[].bassEnvelope` | 24 fps envelope over the full file | max abs diff ≤ 1e-6 (fixture rounding; achieved 5e-7) |
| `filters.butterSos`, `filters.sosfiltfilt` | scipy Butterworth SOS at 6 sample rates; zero-phase filtering of a test signal | rel. 1e-9 / abs 1e-9 |
| `pure.templates` | Python `str.format` results and exception kinds for naming templates | exact (incl. `KeyError`/`ValueError`/`IndexError`) |
| `effects.cases` | radial blur, rotate, overlay, fit, chain, VHS, glitch | per-case `parity`: `exact` (CPU reference, byte-equal) / `visual-only` |

Fixture audio is 11025 Hz 16-bit PCM. Decode it in tests with a tiny TS WAV reader, not a browser decoder, so unit tests run in Node.

**Regenerate** whenever desktop behaviour intentionally changes. Commit the fixtures with the TS change. Never hand-edit them.

## Ported desktop tests

The desktop suite (`docs/reference/desktop-source/tests/`) maps to Vitest as follows:

| Desktop test | Web test |
|---|---|
| `test_parse_timestamp*`, `test_format_timestamp` | golden `pure.*` |
| `test_render_defaults_preserve_original_effect` | `RenderSettings` defaults: bass on, mute on, fades on, `preDrop` 2.0, duration 60, size null |
| `test_artwork_keeps_native_aspect_ratio_and_h264_dimensions` | 801×1201 → 800×1200 |
| `test_artwork_output_profile_letterboxes_without_distortion` | 400×200 into 108×192 → 108×192 canvas |
| `test_find_audio_files_*` | depth-1 filter, case-insensitive sort, single file accepted, non-audio rejected |
| `test_media_validation`, `test_video_visual_is_readable` | validation against decodable fixtures (Playwright, real browser) |
| `test_safe_filename_and_conflict_policies` | golden |
| `test_media_kind_detects_audio_and_video` | golden |
| `test_convert_audio_wav_to_flac` | Playwright: WAV → FLAC produces `Source Audio.flac`, decodable |
| `test_cut_audio_preserves_source_format` | Playwright: WAV clip `Source Audio - Intro.wav`, 0.2 s |
| `test_converter_rejects_unknown_audio_bitrate` | unit: `Audio bitrate must be …` |
| `test_promo_track_options_override_start_and_duration` | unit: per-track start/duration reach the renderer |
| `test_require_ffmpeg_skips_broken_system_binary` | **N/A**. Replaced by capability-routing tests |
| `test_effects.py` (all) | golden effects + no-op invariants (default chain, amount 0, opacity 0, rotate 0°, blur below 0.05) |
| `test_version.py` | golden + "package.json version is semver" |

## Test layers

1. **Unit (Vitest, Node)**: `engine/` pure functions, the CPU effect reference, filters, naming, the template formatter, capability routing (with mocked `isConfigSupported`).
2. **GL parity (Vitest browser mode, `npm run test:gl`)**: `tests/browser/` runs in headless Chromium, WebKit and Firefox. It compares GL effect output to the golden PNGs (deterministic cases) and to the CPU reference (VHS/Glitch at several amounts and times, a reordered full cascade with fade), with max abs diff ≤ 3 and mean ≤ 1. CI runs it per engine in the E2E matrix (`--project "gl (<engine>)"`).
3. **E2E (Playwright: Chromium, WebKit, Firefox)**: the user flows for each tool on tiny fixtures. Assert that outputs decode, with the right duration (±1 frame / ±10 ms), dimensions, and codecs. Use the DownloadSink on WebKit/Firefox and DirectorySink on Chromium (mock directory picker via OPFS).
4. **Benchmarks (manual, Phase 0 and per release)**: render a 60 s 1080×1920 promo, blur only, on the reference machine (record its specs). Track the time per browser in `docs/benchmarks.md`.

## Definition of done for a tool

- Every message string in its spec is present (snapshot tests on the requirements/status text).
- The golden and ported tests pass.
- E2E passes on all three engines (or the test is marked with its documented Tier 2 limitation).
- Cancel removes partial outputs (E2E).
