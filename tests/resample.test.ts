import { describe, expect, it } from "vitest";
import { loopTo, resampleChannel } from "../src/engine/audio/resample";

const sine = (rate: number, hz: number, seconds: number) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));

function rmsError(a: Float32Array, b: Float32Array, skip = 64) {
  let sum = 0;
  let count = 0;
  for (let i = skip; i < Math.min(a.length, b.length) - skip; i++, count++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum / count);
}

describe("resampleChannel", () => {
  it("is the identity at equal rates", () => {
    const x = sine(48_000, 440, 0.1);
    expect(resampleChannel(x, 48_000, 48_000)).toEqual(x);
  });

  it.each([
    [48_000, 44_100],
    [22_050, 44_100],
    [96_000, 44_100],
    [11_025, 44_100],
  ])("%i → %i keeps a 1 kHz tone (length and shape)", (from, to) => {
    const input = sine(from, 1000, 0.5);
    const out = resampleChannel(input, from, to);
    expect(out.length).toBe(Math.round(input.length * (to / from)));
    expect(rmsError(out, sine(to, 1000, 0.5))).toBeLessThan(0.01);
  });

  it("removes content above the new Nyquist when downsampling", () => {
    const out = resampleChannel(sine(96_000, 30_000, 0.5), 96_000, 44_100);
    const rms = Math.sqrt(out.slice(200, -200).reduce((s, v) => s + v * v, 0) / (out.length - 400));
    expect(rms).toBeLessThan(0.05);
  });
});

describe("loopTo (moviepy AudioLoop)", () => {
  it("repeats to the requested length", () => {
    expect(Array.from(loopTo([Float32Array.from([1, 2, 3])], 7)[0]!)).toEqual([1, 2, 3, 1, 2, 3, 1]);
    expect(Array.from(loopTo([new Float32Array(0)], 3)[0]!)).toEqual([0, 0, 0]);
  });
});

describe("StreamResampler", () => {
  it("matches resampling everything at once, for any span sizes", async () => {
    const { StreamResampler, resampleChannel } = await import("../src/engine/audio/resample");
    const input = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i / 7) * 0.6 + Math.sin(i / 1.3) * 0.2);
    for (const [from, to] of [
      [11_025, 48_000],
      [48_000, 44_100],
      [44_100, 48_000],
    ]) {
      const whole = resampleChannel(input, from!, to!);
      const stream = new StreamResampler(1, from!, to!);
      const parts: number[] = [];
      for (let at = 0, step = 1; at < input.length; at += step, step = (step * 7) % 997 + 1) parts.push(...stream.push([input.subarray(at, at + step)])[0]!);
      parts.push(...stream.finish()[0]!);
      expect(parts.length).toBe(whole.length);
      expect(Float32Array.from(parts)).toEqual(whole);
    }
  });
});
