/**
 * HT-Demucs v4 pre/post-processing around the forward-only ONNX export
 * (`webnn/stem-separator`, MIT): the model takes the normalized complex-as-channels
 * spectrogram `x` and waveform `xt` of one 7.8 s segment and returns 4 stems in both domains.
 * Mirrors upstream `htdemucs.py` (`_spec`, `_magnitude`, normalisation, `_mask`, `_ispec`).
 * FFT/STFT ported from demucs-web (MIT, © timcsy).
 */

export const SAMPLE_RATE = 44_100;
export const SEGMENT = 343_980; // training length, 7.8 s
export const FFT = 4096;
export const HOP = 1024;
export const BINS = 2048; // FFT / 2 (the Nyquist bin is dropped)
export const FRAMES = 336; // ceil(SEGMENT / HOP)
export const STEMS = ["drums", "bass", "other", "vocals"] as const;
export type StemName = (typeof STEMS)[number];

// ------------------------------------------------------------------ FFT (radix-2)

const twiddleCache = new Map<number, { re: Float64Array; im: Float64Array }>();
function twiddles(n: number) {
  let t = twiddleCache.get(n);
  if (!t) {
    t = { re: new Float64Array(n / 2), im: new Float64Array(n / 2) };
    for (let k = 0; k < n / 2; k++) {
      t.re[k] = Math.cos((-2 * Math.PI * k) / n);
      t.im[k] = Math.sin((-2 * Math.PI * k) / n);
    }
    twiddleCache.set(n, t);
  }
  return t;
}

/** In-place iterative FFT; `inverse` conjugates the twiddles and scales by 1/n. */
function fftInPlace(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  const t = twiddles(n);
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = t.re[k * step]!;
        const wi = inverse ? -t.im[k * step]! : t.im[k * step]!;
        const a = start + k;
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
  }
}

const hann = (() => {
  const w = new Float64Array(FFT);
  for (let i = 0; i < FFT; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FFT));
  return w;
})();

/** `torch.nn.functional.pad(mode="reflect")`: mirror without repeating the edge sample. */
export function reflectPad(signal: Float32Array, left: number, right: number): Float32Array {
  const n = signal.length;
  const out = new Float32Array(left + n + right);
  for (let i = 0; i < left; i++) out[i] = signal[Math.min(left - i, n - 1)]!;
  out.set(signal, left);
  for (let i = 0; i < right; i++) out[left + n + i] = signal[Math.max(0, n - 2 - i)]!;
  return out;
}

/**
 * `torch.stft(center=True, normalized=True, window=hann)` of an already centre-padded signal:
 * frames × (FFT/2+1) bins, row-major by frame.
 */
function stft(signal: Float32Array): { re: Float32Array; im: Float32Array; frames: number } {
  const frames = Math.floor((signal.length - FFT) / HOP) + 1;
  const bins = FFT / 2 + 1;
  const re = new Float32Array(frames * bins);
  const im = new Float32Array(frames * bins);
  const fr = new Float64Array(FFT);
  const fi = new Float64Array(FFT);
  const scale = 1 / Math.sqrt(FFT);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FFT; i++) {
      fr[i] = signal[f * HOP + i]! * hann[i]!;
      fi[i] = 0;
    }
    fftInPlace(fr, fi, false);
    for (let k = 0; k < bins; k++) {
      re[f * bins + k] = fr[k]! * scale;
      im[f * bins + k] = fi[k]! * scale;
    }
  }
  return { re, im, frames };
}

/** Inverse of `stft` (overlap-add with window-square normalisation), centre padding kept. */
function istft(re: Float32Array, im: Float32Array, frames: number, length: number): Float32Array {
  const bins = FFT / 2 + 1;
  const out = new Float64Array(length);
  const norm = new Float64Array(length);
  const fr = new Float64Array(FFT);
  const fi = new Float64Array(FFT);
  const scale = Math.sqrt(FFT);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < bins; k++) {
      fr[k] = re[f * bins + k]!;
      fi[k] = im[f * bins + k]!;
    }
    for (let k = 1; k < bins - 1; k++) {
      fr[FFT - k] = fr[k]!;
      fi[FFT - k] = -fi[k]!;
    }
    fftInPlace(fr, fi, true);
    const start = f * HOP;
    for (let i = 0; i < FFT && start + i < length; i++) {
      out[start + i] = out[start + i]! + fr[i]! * hann[i]! * scale;
      norm[start + i] = norm[start + i]! + hann[i]! * hann[i]!;
    }
  }
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) result[i] = norm[i]! > 1e-8 ? out[i]! / norm[i]! : 0;
  return result;
}

// ------------------------------------------------------------------ Demucs _spec / _ispec

const PAD = Math.floor(HOP / 2) * 3;

/**
 * `HTDemucs._spec` for one channel of a SEGMENT-long signal: reflect pad, STFT, drop the
 * Nyquist bin, keep frames 2…2+FRAMES. Returns [re, im], each BINS × FRAMES (bin-major).
 */
export function spec(channel: Float32Array): [Float32Array, Float32Array] {
  const le = Math.ceil(SEGMENT / HOP);
  const padded = reflectPad(channel, PAD, PAD + le * HOP - SEGMENT);
  const s = stft(reflectPad(padded, FFT / 2, FFT / 2));
  const bins = FFT / 2 + 1;
  const re = new Float32Array(BINS * FRAMES);
  const im = new Float32Array(BINS * FRAMES);
  for (let f = 0; f < FRAMES; f++) {
    for (let b = 0; b < BINS; b++) {
      re[b * FRAMES + f] = s.re[(f + 2) * bins + b]!;
      im[b * FRAMES + f] = s.im[(f + 2) * bins + b]!;
    }
  }
  return [re, im];
}

/** `HTDemucs._ispec`: zero Nyquist bin, 2 zero frames each side, iSTFT, trim to SEGMENT. */
export function ispec(re: Float32Array, im: Float32Array): Float32Array {
  const frames = FRAMES + 4;
  const bins = FFT / 2 + 1;
  const pr = new Float32Array(frames * bins);
  const pi = new Float32Array(frames * bins);
  for (let f = 0; f < FRAMES; f++) {
    for (let b = 0; b < BINS; b++) {
      pr[(f + 2) * bins + b] = re[b * FRAMES + f]!;
      pi[(f + 2) * bins + b] = im[b * FRAMES + f]!;
    }
  }
  const full = istft(pr, pi, frames, (frames - 1) * HOP + FFT);
  const offset = FFT / 2 + PAD;
  return full.slice(offset, offset + SEGMENT);
}

// ------------------------------------------------------------------ Normalisation

/** Mean and unbiased standard deviation (torch `.std()`). */
function stats(data: Float32Array): { mean: number; std: number } {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i]!;
  const mean = sum / data.length;
  let sq = 0;
  for (let i = 0; i < data.length; i++) sq += (data[i]! - mean) ** 2;
  return { mean, std: Math.sqrt(sq / Math.max(1, data.length - 1)) };
}

export type Normalisation = { mean: number; std: number; meanT: number; stdT: number };

/**
 * `HTDemucs.pre_forward` for one stereo segment (each channel SEGMENT long): the model inputs
 * `x` [1, 4, BINS, FRAMES] (L.re, L.im, R.re, R.im, normalised) and `xt` [1, 2, SEGMENT].
 */
export function preForward(left: Float32Array, right: Float32Array): { x: Float32Array; xt: Float32Array; norm: Normalisation } {
  const plane = BINS * FRAMES;
  const x = new Float32Array(4 * plane);
  const [lr, li] = spec(left);
  const [rr, ri] = spec(right);
  x.set(lr, 0);
  x.set(li, plane);
  x.set(rr, 2 * plane);
  x.set(ri, 3 * plane);
  const { mean, std } = stats(x);
  for (let i = 0; i < x.length; i++) x[i] = (x[i]! - mean) / (1e-5 + std);
  const xt = new Float32Array(2 * SEGMENT);
  xt.set(left, 0);
  xt.set(right, SEGMENT);
  const t = stats(xt);
  for (let i = 0; i < xt.length; i++) xt[i] = (xt[i]! - t.mean) / (1e-5 + t.std);
  return { x, xt, norm: { mean, std, meanT: t.mean, stdT: t.std } };
}

/**
 * De-normalise both branches, rebuild each stem's complex spectrogram (CaC), iSTFT and add
 * the time branch: 4 stems × [left, right], SEGMENT long.
 */
export function postForward(xOut: Float32Array, xtOut: Float32Array, norm: Normalisation): Float32Array[][] {
  const plane = BINS * FRAMES;
  return STEMS.map((_, s) =>
    [0, 1].map((c) => {
      const base = (s * 4 + c * 2) * plane;
      const re = new Float32Array(plane);
      const im = new Float32Array(plane);
      for (let i = 0; i < plane; i++) {
        re[i] = xOut[base + i]! * norm.std + norm.mean;
        im[i] = xOut[base + plane + i]! * norm.std + norm.mean;
      }
      const wave = ispec(re, im);
      const t = (s * 2 + c) * SEGMENT;
      for (let i = 0; i < SEGMENT; i++) wave[i] = wave[i]! + xtOut[t + i]! * norm.stdT + norm.meanT;
      return wave;
    }),
  );
}
