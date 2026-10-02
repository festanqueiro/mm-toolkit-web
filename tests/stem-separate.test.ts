import { describe, expect, it } from "vitest";
import { segmentCount, separate } from "../src/engine/stems/separate";

/** A "model" whose stems are fixed fractions of each segment: overlap-add must be exact. */
const fractions = [0.4, 0.3, 0.2, 0.1];
const fakeRun = async (left: Float32Array, right: Float32Array) => fractions.map((w) => [left.map((v) => v * w), right.map((v) => v * w)]);

async function collect(length: number, segment: number, pad: number) {
  const left = Float32Array.from({ length }, (_, i) => Math.sin(i / 3) + 0.001 * i);
  const right = Float32Array.from({ length }, (_, i) => Math.cos(i / 5));
  const parts: { offset: number; stems: Float32Array[][] }[] = [];
  const segments: number[] = [];
  await separate(left, right, fakeRun, (stems, offset) => void parts.push({ offset, stems }), { segment, pad, onSegment: (i) => segments.push(i) });
  return { left, right, parts, segments };
}

describe("song segmentation", () => {
  for (const [length, segment, pad] of [
    [5, 64, 16], // shorter than one segment
    [1000, 64, 16],
    [1000, 100, 0],
    [4096, 256, 64],
  ] as const) {
    it(`length ${length}, segment ${segment}, pad ${pad}: regions are contiguous and exact`, async () => {
      const { left, right, parts, segments } = await collect(length, segment, pad);
      expect(segments.length).toBe(segmentCount(length, segment, pad));
      // Contiguous, in order, covering exactly the song.
      let at = 0;
      for (const part of parts) {
        expect(part.offset).toBe(at);
        at += part.stems[0]![0]!.length;
      }
      expect(at).toBe(length);
      // Every stem is its fraction of the input, everywhere (weights normalise exactly).
      for (const part of parts) {
        part.stems.forEach((stem, s) =>
          stem.forEach((plane, c) => {
            const src = c === 0 ? left : right;
            for (let i = 0; i < plane.length; i++) expect(plane[i]).toBeCloseTo(src[part.offset + i]! * fractions[s]!, 5);
          }),
        );
      }
    });
  }

  it("stops between segments when cancelled", async () => {
    let n = 0;
    const left = new Float32Array(2000);
    await expect(
      separate(left, left, fakeRun, () => {}, {
        segment: 64,
        checkCancel: () => {
          if (++n > 3) throw new Error("cancelled");
        },
      }),
    ).rejects.toThrow("cancelled");
    expect(n).toBe(4);
  });
});
