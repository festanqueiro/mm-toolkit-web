/** Drop detection and bass envelope — port of `core.detect_drop_time` / `_build_bass_envelope` (spec 02). */

import { butterLowpassSos, sosfiltfilt } from "./filters";

export const BASS_CUTOFF_HZ = 150;
export const ENVELOPE_POWER = 1.6;
export const DROP_SEARCH_BIN_S = 0.5;
export const DROP_SEARCH_SKIP_S = 20;
export const DROP_WINDOW_S = 8;

/** Mono mix the way `_read_mono` does: arithmetic mean of the channels. */
export function toMono(channels: ArrayLike<number>[]): Float64Array {
  const length = channels[0]?.length ?? 0;
  const mono = new Float64Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i]! += channel[i]!;
  if (channels.length > 1) for (let i = 0; i < length; i++) mono[i]! /= channels.length;
  return mono;
}

/** 4th-order Butterworth low-pass at 150 Hz, zero-phase. */
export function bassBand(mono: ArrayLike<number>, sampleRate: number): Float64Array {
  const wn = Math.min(BASS_CUTOFF_HZ / (sampleRate / 2), 0.99);
  return sosfiltfilt(butterLowpassSos(4, wn), mono);
}

function rms(data: Float64Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i]! * data[i]!;
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

function mean(values: Float64Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += values[i]!;
  return sum / (end - start);
}

/** Seconds of the biggest bass-energy jump (a multiple of 0.5 s). */
export function detectDropTime(mono: ArrayLike<number>, sampleRate: number): number {
  const bass = bassBand(mono, sampleRate);
  const window = Math.max(1, Math.floor(DROP_SEARCH_BIN_S * sampleRate));
  const count = Math.floor(bass.length / window);
  if (count < 2) return 0;
  const bins = new Float64Array(count);
  for (let i = 0; i < count; i++) bins[i] = rms(bass, i * window, (i + 1) * window);
  const scan = Math.max(1, Math.floor(DROP_WINDOW_S / DROP_SEARCH_BIN_S));
  const start = Math.min(Math.floor(DROP_SEARCH_SKIP_S / DROP_SEARCH_BIN_S), Math.max(0, count - 1));
  let bestIndex = start;
  let bestScore = Number.NEGATIVE_INFINITY;
  const stop = Math.max(start + 1, count - scan);
  for (let index = start; index < stop; index++) {
    const beforeStart = Math.max(0, index - scan);
    const before = index > beforeStart ? mean(bins, beforeStart, index) : 0;
    const after = mean(bins, index, Math.min(count, index + scan));
    const score = after - before;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex * DROP_SEARCH_BIN_S;
}

/** Suggested promo start: `max(0, drop − secondsBefore)` (desktop default lead-in 2.0 s). */
export function detectDropStart(mono: ArrayLike<number>, sampleRate: number, secondsBefore = 2): number {
  return Math.max(0, detectDropTime(mono, sampleRate) - secondsBefore);
}

/**
 * Per-video-frame bass strength in 0..1 for a trimmed snippet. Note the desktop truncates
 * the window to `floor(sampleRate / fps)` samples, so frames drift slightly; replicated on purpose.
 */
export function buildBassEnvelope(snippetMono: ArrayLike<number>, sampleRate: number, fps: number, duration: number): Float64Array {
  const bass = bassBand(snippetMono, sampleRate);
  const frameCount = Math.max(1, Math.floor(duration * fps));
  const window = Math.max(1, Math.floor(sampleRate / fps));
  const envelope = new Float64Array(frameCount);
  let peak = 0;
  for (let i = 0; i < frameCount; i++) {
    const start = Math.min(bass.length, i * window);
    envelope[i] = rms(bass, start, Math.min(bass.length, start + window));
    peak = Math.max(peak, envelope[i]!);
  }
  for (let i = 0; i < frameCount; i++) {
    const normalised = peak > 0 ? envelope[i]! / peak : envelope[i]!;
    envelope[i] = Math.min(1, Math.max(0, normalised)) ** ENVELOPE_POWER;
  }
  return envelope;
}

/** Bass strength for the frame at time `t` (`min(int(t·fps), len − 1)`). */
export function envelopeAt(envelope: ArrayLike<number>, t: number, fps: number): number {
  return envelope[Math.min(Math.floor(t * fps), envelope.length - 1)] ?? 0;
}
