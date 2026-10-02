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
