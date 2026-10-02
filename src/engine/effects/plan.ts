/**
 * Per-frame random decisions shared by the CPU reference and the WebGL shaders, so both
 * draw the same VHS grain and Glitch slices for a given time (spec 03: visual parity with
 * the desktop's numpy RNG, exact determinism per `t`).
 */

import { pyRound } from "../py";
import { SeededRandom } from "./cpu/rng";

/** Glitch iterations at amount 1: `floor(2 + 10 * amount)`. Sizes the shader's uniform array. */
export const MAX_GLITCH_SLICES = 12;

export type GlitchSlice = { y0: number; y1: number; shift: number };
export type GlitchPlan = { slices: GlitchSlice[]; blueShift: number };

/** The row slices `apply_glitch` rolls, and its blue-channel split (0 when amount ≤ 0.3). */
export function glitchPlan(amount: number, time: number, width: number, height: number): GlitchPlan {
  const rng = new SeededRandom(Math.trunc(time * 1000) + 1);
  const slices: GlitchSlice[] = [];
  const iterations = Math.trunc(2 + 10 * amount);
  for (let i = 0; i < iterations; i++) {
    if (rng.random() > amount + 0.2) continue;
    const y0 = rng.integers(0, height);
    const y1 = Math.min(height, y0 + rng.integers(2, Math.max(3, Math.trunc(height * 0.05) + 1)));
    const shift = rng.integers(Math.floor(-width / 8), Math.floor(width / 8) + 1);
    slices.push({ y0, y1, shift });
  }
  return { slices, blueShift: amount > 0.3 ? pyRound(4 * amount) : 0 };
}

/** VHS grain seed: numpy `default_rng(int(t * 1000))`. */
export const vhsSeed = (time: number) => Math.trunc(time * 1000) >>> 0;

/** lowbias32 integer hash (Chris Wellons); the GLSL twin is `HASH_GLSL`. */
export function hash32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** Uniform in (0, 1) from the top 24 bits, exactly representable in float32. */
const unit = (h: number) => ((h >>> 8) + 0.5) / 16777216;

/** Standard normal sample for pixel `(x, y)`, channel `c`: Box–Muller over two hashes. */
export function vhsNoise(x: number, y: number, c: number, seed: number): number {
  const h1 = hash32(seed ^ hash32(y ^ hash32(x * 3 + c)));
  const h2 = hash32(h1);
  return Math.sqrt(-2 * Math.log(unit(h1))) * Math.cos(2 * Math.PI * unit(h2));
}

/** GLSL ES 3.00 versions of `hash32` / `vhsNoise`. */
export const HASH_GLSL = `
uint hash32(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float unit24(uint h) { return (float(h >> 8u) + 0.5) / 16777216.0; }
float vhsNoise(int x, int y, int c, uint seed) {
  uint h1 = hash32(seed ^ hash32(uint(y) ^ hash32(uint(x * 3 + c))));
  uint h2 = hash32(h1);
  return sqrt(-2.0 * log(unit24(h1))) * cos(6.283185307179586 * unit24(h2));
}
`;
