# 15 — Stem Splitter

A web-only tool (not in the desktop app, requested 2026-10-02): separate a song into **vocals, drums, bass and other**, fully on the device. Subtitle: *"Split a song into vocals, drums, bass and other instruments. Everything runs on this device."*

## Model

- **HT-Demucs v4** (Meta, MIT), forward-only ONNX export **`webnn/stem-separator`** (MIT), pinned to revision `b56f9e66ceffca2401f83d2469dadaddd06e4994`:

  | File | Bytes | SHA-256 |
  |---|---|---|
  | `onnx/htdemucs_fwd.onnx` | 2,385,507 | `555f511fb653348a1c9495ab6b6091767d1920798f3fba68629a1fe5b135a45f` |
  | `onnx/htdemucs_fwd.onnx.data` | 168,361,984 | `23a7c68669c041363caaef94641e961dc8c4e16b9891cb87f58f0e199a5e8820` |

- Downloaded **once** from Hugging Face (CORS-enabled; redirects to `*.hf.co`), verified by SHA-256, then kept in Cache Storage (`stem-models-v1`) for offline use. Only the model is fetched; **audio never leaves the device**. CSP `connect-src` allows `https://huggingface.co https://*.hf.co` for this.
- Why this export: the single-file exports bake STFT/iSTFT into the graph and use ops `onnxruntime-web` can't run (spike: `ConstantOfShape` in the iSTFT has no WASM kernel). The forward-only export leaves STFT, normalisation and iSTFT to the app.
- Runtime: **`onnxruntime-web`** (MIT) in the job Worker. The Stem Splitter keeps **one long-lived worker** and never terminates it: WebKit crashes the page when a worker holding a WebGPU device is terminated. Cancel is cooperative (between segments). **WebGPU** when an adapter exists, else **WASM** single-threaded (GitHub Pages can't send cross-origin-isolation headers, so no threads). The 27 MB ORT WASM (`ort-wasm-simd-threaded.asyncify.wasm`, the build the WebGPU bundle's glue targets) is served from our origin and cached on first use (not precached).

## Pipeline (`engine/stems/`)

Per 7.8 s segment (`SEGMENT = 343,980` samples at 44.1 kHz), mirroring upstream `htdemucs.py`:

1. **`_spec`**: reflect-pad by `1536` / `1536 + 336·1024 − SEGMENT`, then a centred, normalised 4096-point Hann STFT with hop 1024; drop the Nyquist bin and keep frames 2…337 → `[2048, 336]` per channel.
2. **`_magnitude` (CaC)**: channels `L.re, L.im, R.re, R.im`.
3. **Normalise**: `x = (spec − mean) / (1e-5 + std)`; `xt = (wave − meanT) / (1e-5 + stdT)` (torch `std`, unbiased).
4. **Model**: `x [1,4,2048,336]`, `xt [1,2,343980]` → `x_out [1,16,2048,336]`, `xt_out [1,8,343980]`.
5. **Post**: de-normalise, rebuild each stem's complex spectra, **`_ispec`** (zero Nyquist bin, 2 zero frames each side, iSTFT, offset `2048 + 1536`), add the de-normalised time branch.

Song level:

- Decode, mix to stereo (mono duplicated) and resample to 44.1 kHz.
- Pad the song with **8192 zero samples at each end**, removed after. `_ispec` attenuates the outer 2048 samples of every segment (upstream too); padding keeps the song's first/last 46 ms intact.
- Segments with **25 % overlap**, each weighted by a linear fade-in/fade-out window of the overlap length, summed and divided by the summed weights (`infer.py` reference).
- Stems are **streamed** to their encoders as soon as a region can no longer change (everything before the next segment's start), so memory is bounded by the source plus one segment.
- Stem order from the model: drums, bass, other, vocals.

Validated against the real model (spike): the four stems sum back to the mix at **32.9 dB SNR**; WebGPU and WASM outputs agree to 4 decimals.

## Layout

Two columns, like the Media Cutter.

**Left — Input**: drop zone **Source audio** (audio or video file; video uses its soundtrack) · status.

**Right — Stems** (group):
- Checkboxes **Vocals**, **Drums**, **Bass**, **Other**, and **Instrumental** (everything but vocals: drums + bass + other). Default: Vocals + Instrumental.
- **Output format**: the Converter's audio formats (`WAV AIFF FLAC MP3 M4A AAC OGG`, default **WAV**) and **MP3 bitrate** for MP3.
- **Export folder** + status (as other tools).
- **Model** line: `Model: HT-Demucs (170 MB, downloaded once)` · `✓ Model ready on this device` · `Downloading model… {n}%`.

**Footer**: progress + bar · **Clear** · **Cancel** · requirements · **Split Stems**.

After a job, the finished files are listed with an inline player each (same as History's rendered files).

## Messages

| Where | Text |
|---|---|
| Source status | `✓ Source ready.` · `The selected file is not supported audio or video.` |
| Stems status | `✓ {n} stem{s} selected.` · `Choose at least one stem.` |
| Requirements | `To enable Split Stems: ` + [`choose a source`, `choose at least one stem`, `choose a writable export folder`] · `✓ Ready to split stems.` · `Splitting stems…` |
| Progress | `Downloading model… {n}%` · `Preparing {name}…` · `Separating {name} ({i} of {n})` · `Writing stems…` · `Finished {n} stem{s}` · `Cancelling safely…` · `Cancelled. Partial files were removed.` |
| Backend note (warn) | `This browser has no WebGPU, so separation runs on the CPU (slower: several minutes per song).` |
| Errors | `The stem model could not be downloaded. Check your connection and try again.` · `The downloaded stem model is damaged. Try again.` · error dialog title `Stem splitting failed` |

## Output

- One file per selected stem: **`{source stem} - {Stem}.{ext}`** (`Vocals`, `Drums`, `Bass`, `Other`, `Instrumental`), conflict policy from Settings.
- Encoded at 44.1 kHz stereo with the Converter's settings for the chosen format (`engine/render/transcode.ts` PCM encoder; Opus at 48 kHz).
- History record: `{ "tool": "stems", "created", "source": {name,size,lastModified}, "output": "<ref>", "stems": ["vocals", …], "format": "wav", "bitrate": "320k", "outputs": [...] }`. Load Job restores stems, format, bitrate and export folder and asks to re-select the source.

## Performance (spike, per 7.8 s segment, ~5.85 s of song each)

| Backend | Model | Pre + post (JS) |
|---|---|---|
| WebGPU (WebKit) | 2.8 s | 0.8 s |
| WASM, 1 thread (Chromium/Firefox/WebKit) | ~10 s | 0.4–0.8 s |

A 4-minute song: ~2.5 min with WebGPU, ~7.5 min on WASM (headless measurements; real GPUs are faster).

## Testing

- Unit: STFT/iSTFT geometry (exact interior reconstruction), pre/post round trip, segmentation/overlap-add, naming and rules.
- e2e: a **607-byte stand-in model** with the same I/O (`fixtures/stems/fake-htdemucs.onnx`, built by `scripts/make_fake_stem_model.py`, IR 9: stems = 0.4/0.3/0.2/0.1 of the mix), so CI never downloads the real model. Tests set `window.__MM_STEM_MODEL__` (a model descriptor with a `data:` URL and its SHA-256) before the app loads; the app otherwise always uses the pinned HT-Demucs files.
- Manual check with the real model (production build, real Hugging Face download, 12 s song, WASM): 45 s total; the 4 WAV stems sum back to the source at **34.0 dB SNR** (31/40 dB in the first/last 50 ms, so the song padding works).
