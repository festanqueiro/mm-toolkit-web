/**
 * Seeded PRNG for VHS noise and Glitch slices. The desktop uses numpy's PCG64
 * (`default_rng(seed)`); reproducing that stream isn't a goal (spec 03: visual parity),
 * but the same seed must always give the same frame.
 */
export class SeededRandom {
  private state: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.state = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;
  }

  /** Uniform float in [0, 1) (mulberry32). */
  random(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [low, high), like `Generator.integers(low, high)`. */
  integers(low: number, high: number): number {
    return low + Math.floor(this.random() * (high - low));
  }

  /** Normal sample (Box–Muller). */
  normal(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;
      return mean + sd * value;
    }
    const u = 1 - this.random();
    const v = this.random();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return mean + sd * r * Math.cos(2 * Math.PI * v);
  }
}
