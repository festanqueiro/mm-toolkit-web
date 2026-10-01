# 02 — Audio Analysis (drop detection & bass envelope)

Port of `detect_drop_time`, `detect_drop_starts`, `_build_bass_envelope` and `_read_mono` from `core.py`. These are **pure maths** and must match desktop **numerically**. They're verified against `fixtures/golden/golden.json → audio.tracks`.

## Input normalisation

The desktop first runs FFmpeg: `-ac 2 -c:a pcm_s16le` (stereo, 16-bit PCM, **native sample rate kept**, since there's no `-ar`). It then reads the WAV with `soundfile` and averages the channels to mono.

Web equivalent:

1. Decode the file to PCM at its **native sample rate**. Don't use an `AudioContext`'s default rate. Use WebCodecs `AudioDecoder` or `OfflineAudioContext({ sampleRate: <file rate> })`, or the WASM path.
2. Stereo-ise the way FFmpeg does for `-ac 2`. Mono gets duplicated; stereo passes through. More than 2 channels: FFmpeg's default downmix. Treat multichannel as best-effort.
3. **Quantise to 16-bit and back** (`Math.round(x*32767)/32767`, clamped) if exact parity matters. The fixtures are already 16-bit, so this is a no-op for tests. Note that `soundfile` reads `PCM_16` as `x/32768`.
4. Mono = arithmetic mean of the two channels.

## Constants

| Name | Value | Meaning |
|---|---|---|
| `BASS_CUTOFF_HZ` | 150 | Low-pass cutoff |
| `ENVELOPE_POWER` | 1.6 | Envelope shaping exponent |
| `DROP_SEARCH_BIN_S` | 0.5 | RMS bin length (s) |
| `DROP_SEARCH_SKIP_S` | 20 | Ignore the first 20 s when searching |
| `DROP_WINDOW_S` | 8 | Compare 8 s after vs. 8 s before |

## Low-pass filter

- 4th-order Butterworth low-pass in **second-order sections** (`scipy.signal.butter(4, Wn, btype="low", output="sos")`).
- `Wn = min(150 / (sampleRate / 2), 0.99)`.
- Applied **zero-phase** with `sosfiltfilt`: forward pass, then backward pass, with scipy's default **odd padding** (`padtype="odd"`) and initial conditions from `sosfilt_zi`. To match closely, port these details:
  - `padlen = 3 * (2 * len(sos) + 1 - min((sos[:, 2] == 0).sum(), (sos[:, 5] == 0).sum()))` → for 2 sections typically `3 * 5 = 15` samples.
  - Odd extension at both ends, steady-state initial conditions scaled by the first sample of each pass.
- **Filter in float64 (`Float64Array`).** At 44.1 kHz the first section's numerator is ~1.27e-8 (`[1.268e-08, 2.536e-08, 1.268e-08, 1, -1.96083, 0.961278]`), and float32 state would lose precision badly.
- The TS port lives in `engine/analysis/filters.ts`. Design the SOS coefficients in TS (bilinear transform of the analogue Butterworth prototype, as scipy does). **Unit-test the coefficients** against scipy for 11025, 44100 and 48000 Hz. Generate them with the golden script if needed.

> Simplification allowed only if parity holds: the drop search uses 0.5 s RMS bins, so small filter-edge differences rarely change the result. The **bass envelope** is more sensitive, so test it to a tolerance (see below).

## `detectDropTime(mono, sampleRate) → seconds`

```
bass   = sosfiltfilt(butter4_lowpass(150Hz), mono)
window = max(1, floor(0.5 * sampleRate))           # samples per bin
count  = floor(len(bass) / window)
if count < 2: return 0.0
rms[i] = sqrt(mean(bass[i*window : (i+1)*window]^2))   for i in 0..count-1
scan   = max(1, floor(8 / 0.5)) = 16                   # bins
start  = min(floor(20 / 0.5) = 40, max(0, count - 1))
best_index = start; best_score = -inf
for index in [start, max(start + 1, count - scan)):     # half-open range
    before = rms[max(0, index - scan) : index]
    after  = rms[index : index + scan]
    score  = mean(after) - (mean(before) if before non-empty else 0)
    if score > best_score:                               # strict: first max wins
        best_index, best_score = index, score
return best_index * 0.5
```

**Known quirk, replicated for parity:** tracks shorter than ~28 s clamp `start` to `count - 1`. The proposed drop then lands near the very end. Example: the 10 s fixture yields `9.5`. Keep this behaviour for parity, and log it in the roadmap as a candidate improvement. Don't silently "fix" it.

## `detectDropStarts(sources, secondsBefore = 2.0)`

For each source: normalise → `max(0, detectDropTime − secondsBefore)`. Progress messages: `"Detecting drop in {name}"` at `round(i / n * 100)`, then `100, "Drop detection finished"`.

## `buildBassEnvelope(snippetMono, sampleRate, fps, duration) → Float32Array`

The input is the **trimmed snippet** (see Video Creator pipeline), not the whole track.

```
bass        = sosfiltfilt(butter4_lowpass(150Hz), snippet)
frameCount  = max(1, floor(duration * fps))
window      = max(1, floor(sampleRate / fps))        # NOTE: truncated, see below
env[i]      = sqrt(mean(bass[i*window : (i+1)*window]^2))  (0 if the slice is empty)
peak        = max(env); if peak > 0: env /= peak
env         = clip(env, 0, 1) ^ 1.6
```

**Parity note:** `window` is truncated (`44100/24 = 1837.5 → 1837`), so frame `i` reads `[i*1837, (i+1)*1837)` rather than `i*sr/fps`. Over 60 s this drifts by about 16 ms. **Replicate it**, because the fixtures encode it.

Per-frame lookup during render: `strength = env[min(floor(t * fps), env.length - 1)]`.

## Tolerances (tests)

| Output | Assertion |
|---|---|
| `detectDropTime` | exact equality (it's a multiple of 0.5) |
| `detectDropStartWithLeadIn2s` | exact |
| `bassEnvelope.values` | max abs diff ≤ 1e-3, and same length |

## Performance budget

Analysing a 7-minute 44.1 kHz track in a Worker should finish in **under 1 s** on a mid-range laptop. The desktop's "Analyzing … for its main drop…" status covers the UI.
