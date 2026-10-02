/**
 * Band-limited resampling (Lanczos-windowed sinc). The desktop's moviepy writes promo audio
 * at 44.1 kHz whatever the input rate (`write_videofile(audio_fps=44100)`), so the render
 * resamples to match; FFmpeg's resampler isn't reproduced bit-for-bit, only its intent.
 */

/** Output sample rate of rendered promos (moviepy default). */
export const PROMO_AUDIO_RATE = 44_100;

const HALF_TAPS = 16;

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** Resample one channel from `from` Hz to `to` Hz. */
export function resampleChannel(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice();
  const ratio = to / from;
  const length = Math.round(input.length * ratio);
  const out = new Float32Array(length);
  // Downsampling: widen the kernel so it also low-passes below the new Nyquist.
  const cutoff = Math.min(1, ratio);
  const half = Math.ceil(HALF_TAPS / cutoff);
  for (let n = 0; n < length; n++) {
    const center = n / ratio;
    const first = Math.max(0, Math.floor(center) - half + 1);
    const last = Math.min(input.length - 1, Math.floor(center) + half);
    let sum = 0;
    let weight = 0;
    for (let k = first; k <= last; k++) {
      const x = (k - center) * cutoff;
      const w = sinc(x) * sinc(x / HALF_TAPS) * (Math.abs(x) < HALF_TAPS ? 1 : 0);
      sum += input[k]! * w;
      weight += w;
    }
    out[n] = weight !== 0 ? sum / weight : 0;
  }
  return out;
}

/**
 * `resampleChannel` over a stream: push spans, get the output that's already determined, and
 * `finish()` for the tail. Identical to resampling the concatenated input in one go, while
 * holding only the kernel's context between spans.
 */
export class StreamResampler {
  private readonly ratio: number;
  private readonly cutoff: number;
  private readonly half: number;
  private pending: Float32Array[];
  /** Absolute input index of `pending[c][0]`. */
  private base = 0;
  private received = 0;
  private produced = 0;

  constructor(
    channels: number,
    private readonly from: number,
    private readonly to: number,
  ) {
    this.ratio = to / from;
    this.cutoff = Math.min(1, this.ratio);
    this.half = Math.ceil(HALF_TAPS / this.cutoff);
    this.pending = Array.from({ length: channels }, () => new Float32Array(0));
  }

  push(span: Float32Array[]): Float32Array[] {
    if (this.from === this.to) return span.map((c) => c.slice());
    this.pending = this.pending.map((old, c) => {
      const next = new Float32Array(old.length + span[c]!.length);
      next.set(old);
      next.set(span[c]!, old.length);
      return next;
    });
    this.received += span[0]?.length ?? 0;
    // Output n is determined once its kernel's last input exists.
    let end = this.produced;
    while (Math.floor(end / this.ratio) + this.half <= this.received - 1) end++;
    return this.emit(end, false);
  }

  finish(): Float32Array[] {
    if (this.from === this.to) return this.pending.map(() => new Float32Array(0));
    return this.emit(Math.round(this.received * this.ratio), true);
  }

  private emit(end: number, final: boolean): Float32Array[] {
    const count = Math.max(0, end - this.produced);
    const out = this.pending.map(() => new Float32Array(count));
    for (let i = 0; i < count; i++) {
      const center = (this.produced + i) / this.ratio;
      const first = Math.max(0, Math.floor(center) - this.half + 1);
      const last = Math.min(this.received - 1, Math.floor(center) + this.half);
      this.pending.forEach((input, c) => {
        let sum = 0;
        let weight = 0;
        for (let k = first; k <= last; k++) {
          const x = (k - center) * this.cutoff;
          const w = sinc(x) * sinc(x / HALF_TAPS) * (Math.abs(x) < HALF_TAPS ? 1 : 0);
          sum += input[k - this.base]! * w;
          weight += w;
        }
        out[c]![i] = weight !== 0 ? sum / weight : 0;
      });
    }
    this.produced += count;
    if (!final) {
      // Keep only what future outputs' kernels can still reach.
      const keepFrom = Math.max(this.base, Math.floor(this.produced / this.ratio) - this.half + 1);
      this.pending = this.pending.map((input) => input.slice(keepFrom - this.base));
      this.base = keepFrom;
    }
    return out;
  }
}

export function resample(channels: Float32Array[], from: number, to: number): Float32Array[] {
  return channels.map((channel) => resampleChannel(channel, from, to));
}

/**
 * moviepy `AudioLoop(duration)`: repeat `channels` until `frames` samples. An empty input
 * yields silence.
 */
export function loopTo(channels: Float32Array[], frames: number): Float32Array[] {
  return channels.map((channel) => {
    const out = new Float32Array(frames);
    if (!channel.length) return out;
    for (let offset = 0; offset < frames; offset += channel.length) out.set(channel.subarray(0, Math.min(channel.length, frames - offset)), offset);
    return out;
  });
}
