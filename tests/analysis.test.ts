import { describe, expect, it } from "vitest";
import { buildBassEnvelope, detectDropStart, detectDropTime, envelopeAt, toMono } from "../src/engine/analysis/drop";
import { butterLowpassSos, sosfiltfilt } from "../src/engine/analysis/filters";
import { golden, goldenFile } from "./golden";
import { readWav16 } from "./wav";

const maxAbsDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!));
  return max;
};

describe("butterLowpassSos (vs scipy.signal.butter)", () => {
  it.each(Object.entries(golden.filters.butterSos))("%s Hz", (rate, expected) => {
    const sos = butterLowpassSos(4, Math.min(150 / (Number(rate) / 2), 0.99));
    expect(sos).toHaveLength(expected.length);
    sos.forEach((section, s) =>
      section.forEach((value, i) => {
        const want = expected[s]![i]!;
        expect(Math.abs(value - want)).toBeLessThanOrEqual(Math.abs(want) * 1e-9 + 1e-15);
      }),
    );
  });
});

describe("sosfiltfilt (vs scipy)", () => {
  it("matches scipy's zero-phase output", () => {
    const { sampleRate, input, output } = golden.filters.sosfiltfilt;
    const sos = butterLowpassSos(4, 150 / (sampleRate / 2));
    expect(maxAbsDiff(sosfiltfilt(sos, input), output)).toBeLessThan(1e-9);
  });
});

describe.each(golden.audio.tracks)("$file", (track) => {
  const pcm = readWav16(goldenFile(track.file));
  const mono = toMono(pcm.channels);

  it("reads the fixture", () => {
    expect(pcm.sampleRate).toBe(track.sampleRate);
    expect(pcm.channels).toHaveLength(track.channels);
  });

  it(`detectDropTime = ${track.detectDropTime}`, () => {
    expect(detectDropTime(mono, pcm.sampleRate)).toBe(track.detectDropTime);
    expect(detectDropStart(mono, pcm.sampleRate)).toBe(track.detectDropStartWithLeadIn2s);
  });

  it("bass envelope matches desktop (fixture is rounded to 6 decimals)", () => {
    const { fps, duration, values } = track.bassEnvelope;
    const envelope = buildBassEnvelope(mono, pcm.sampleRate, fps, duration);
    expect(envelope).toHaveLength(values.length);
    expect(maxAbsDiff(envelope, values)).toBeLessThanOrEqual(1e-6);
  });
});

describe("edge cases", () => {
  it("returns 0 when there are fewer than two bins", () => {
    expect(detectDropTime(new Float64Array(5000), 11025)).toBe(0);
  });
  it("envelopeAt clamps to the last frame", () => {
    expect(envelopeAt([0.1, 0.2, 0.3], 10, 24)).toBe(0.3);
    expect(envelopeAt([0.1, 0.2, 0.3], 1 / 24, 24)).toBe(0.2);
  });
  it("silence yields an all-zero envelope", () => {
    expect([...buildBassEnvelope(new Float64Array(11025), 11025, 24, 1)].every((v) => v === 0)).toBe(true);
  });
});
