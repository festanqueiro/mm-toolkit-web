import { describe, expect, it } from "vitest";
import { BINS, FRAMES, ispec, postForward, preForward, reflectPad, SEGMENT, spec } from "../src/engine/stems/demucs";

const signal = (seed: number) => Float32Array.from({ length: SEGMENT }, (_, i) => 0.4 * Math.sin(i / (7 + seed)) + 0.2 * Math.sin(i / 1.9) + 0.05 * Math.sin(i * 0.37 + seed));

describe("HT-Demucs spectral geometry", () => {
  it("reflect padding mirrors without the edge sample (torch semantics)", () => {
    expect(Array.from(reflectPad(Float32Array.from([1, 2, 3, 4]), 2, 2))).toEqual([3, 2, 1, 2, 3, 4, 3, 2]);
  });

  /** Max |a − b| over [from, to). */
  const maxErr = (a: Float32Array, b: Float32Array, from: number, to: number) => {
    let e = 0;
    for (let i = from; i < to; i++) e = Math.max(e, Math.abs(a[i]! - b[i]!));
    return e;
  };

  it("spec → ispec reconstructs the segment exactly except Demucs' 2048-sample edges", () => {
    const x = signal(0);
    const [re, im] = spec(x);
    expect(re.length).toBe(BINS * FRAMES);
    const back = ispec(re, im);
    // `_ispec` zeroes the two padding frames at each end, so the outer 2048 samples are
    // attenuated (upstream too); overlap-add and the song padding in the segmenter hide them.
    expect(maxErr(back, x, 2048, SEGMENT - 2048)).toBeLessThan(1e-5);
    expect(maxErr(back, x, 0, 512)).toBeGreaterThan(1e-3);
  });

  it("pre → post round trip: an identity 'model' (each stem = mix / 4) sums back to the mix", () => {
    const left = signal(1);
    const right = signal(2);
    const { x, norm } = preForward(left, right);
    // Normalised inputs: zero mean, unit variance.
    const mean = x.reduce((s, v) => s + v, 0) / x.length;
    expect(Math.abs(mean)).toBeLessThan(1e-4);
    // Identity model in normalised units: stem_s = x / 4 would not de-normalise linearly
    // (the mean is added per stem), so build outputs whose de-normalised values are mix / 4.
    const plane = BINS * FRAMES;
    const xOut = new Float32Array(16 * plane);
    const xtOut = new Float32Array(8 * SEGMENT);
    for (let s = 0; s < 4; s++) {
      for (let c = 0; c < 4 * plane; c++) {
        const raw = x[c]! * (1e-5 + norm.std) + norm.mean; // undo pre_forward
        xOut[s * 4 * plane + c] = (raw / 4 - norm.mean) / norm.std;
      }
      for (let i = 0; i < 2 * SEGMENT; i++) xtOut[s * 2 * SEGMENT + i] = -norm.meanT / norm.stdT; // time branch adds 0
    }
    const stems = postForward(xOut, xtOut, norm);
    let err = 0;
    for (const [c, mix] of [left, right].entries()) {
      for (let i = 2048; i < SEGMENT - 2048; i += 7) err = Math.max(err, Math.abs(stems.reduce((sum, stem) => sum + stem[c]![i]!, 0) - mix[i]!));
    }
    expect(err).toBeLessThan(1e-3);
  });
});
