import { describe, expect, it } from "vitest";
import { applyVideoFade } from "../src/engine/effects/cpu/effects";
import { solidImage } from "../src/engine/effects/cpu/image";
import { applyAudioFade, fadeLength, videoFadeGain } from "../src/engine/effects/fade";
import { glitchPlan, hash32, MAX_GLITCH_SLICES, vhsNoise, vhsSeed } from "../src/engine/effects/plan";

describe("fades (moviepy FadeIn/FadeOut, AudioFadeIn/AudioFadeOut)", () => {
  it("fade length is min(0.5, duration / 2)", () => {
    expect(fadeLength(60)).toBe(0.5);
    expect(fadeLength(0.6)).toBe(0.3);
  });

  it("video gain ramps in and out and is 1 in between", () => {
    expect(videoFadeGain(0, 10, 0.5)).toBe(0);
    expect(videoFadeGain(0.25, 10, 0.5)).toBe(0.5);
    expect(videoFadeGain(0.5, 10, 0.5)).toBe(1);
    expect(videoFadeGain(5, 10, 0.5)).toBe(1);
    expect(videoFadeGain(9.75, 10, 0.5)).toBe(0.5);
    // Overlapping windows multiply, like the chained moviepy effects.
    expect(videoFadeGain(0.5, 1, 0.5)).toBe(1);
    expect(videoFadeGain(0.25, 0.8, 0.4)).toBeCloseTo(0.625 * 1, 12);
  });

  it("video fade truncates like astype(uint8)", () => {
    const out = applyVideoFade(solidImage(2, 1, [255, 100, 3]), 0.5);
    expect([...out.data]).toEqual([127, 50, 1, 127, 50, 1]);
  });

  it("audio fade applies min(t/fade,1) * min((dur-t)/fade,1) per sample", () => {
    const rate = 100;
    const frames = 1000; // 10 s
    const plane = new Float32Array(frames).fill(1);
    applyAudioFade([plane], frames, rate, 0.5);
    expect(plane[0]).toBe(0);
    expect(plane[25]).toBeCloseTo(0.5, 6);
    expect(plane[50]).toBe(1);
    expect(plane[500]).toBe(1);
    expect(plane[frames - 25]).toBeCloseTo(0.5, 6);
    expect(plane[frames - 1]).toBeCloseTo(0.02, 6);
  });

  it("audio fade on a clip shorter than both windows applies each sample once", () => {
    const plane = new Float32Array(10).fill(1);
    applyAudioFade([plane], 10, 10, 0.5);
    for (let n = 0; n < 10; n++) expect(plane[n]).toBeCloseTo(Math.min(n / 5, 1) * Math.min((1 - n / 10) / 0.5, 1), 6);
  });
});

describe("shared random plan (CPU ↔ GL)", () => {
  it("glitch plan is deterministic and bounded", () => {
    const a = glitchPlan(1, 2.5, 60, 40);
    expect(glitchPlan(1, 2.5, 60, 40)).toEqual(a);
    expect(a.slices.length).toBeLessThanOrEqual(MAX_GLITCH_SLICES);
    for (const s of a.slices) {
      expect(s.y0).toBeGreaterThanOrEqual(0);
      expect(s.y1).toBeLessThanOrEqual(40);
      expect(s.y1).toBeGreaterThan(s.y0);
      expect(s.shift).toBeGreaterThanOrEqual(-8);
      expect(s.shift).toBeLessThanOrEqual(7);
    }
    expect(a.blueShift).toBe(4);
    expect(glitchPlan(0.3, 2.5, 60, 40).blueShift).toBe(0);
  });

  it("hash and noise are stable across runs (the shader relies on these values)", () => {
    expect(hash32(0)).toBe(0);
    expect(hash32(1)).toBe(hash32(1));
    expect(hash32(1)).not.toBe(hash32(2));
    expect(vhsSeed(1.0005)).toBe(1000);
    let sum = 0;
    let sq = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = vhsNoise(i % 200, Math.floor(i / 200), i % 3, 42);
      sum += v;
      sq += v * v;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.05);
    expect(Math.abs(sq / n - 1)).toBeLessThan(0.05);
  });
});
