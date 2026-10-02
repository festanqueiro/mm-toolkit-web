import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PeakAccumulator } from "../src/engine/analysis/peaks";
import { decodeAiff } from "../src/engine/media/aiff";
import { streamAudio } from "../src/engine/media/audio-decode";
import { readWav16 } from "./wav";

describe("PeakAccumulator", () => {
  it("tracks min/max of the mono mix per column across chunks", () => {
    const acc = new PeakAccumulator(2, 8);
    acc.add([Float32Array.from([0.5, -0.5, 1, 0]), Float32Array.from([0.5, 0.5, 0, 0])], 0);
    acc.add([Float32Array.from([0, 0, -1, 0.25])], 4);
    expect(Array.from(acc.peaks)).toEqual([0, 0.5, -1, 0.25]);
  });
});

async function streamed(file: File, columns: number) {
  let acc: PeakAccumulator | null = null;
  let rate = 0;
  let last = 0;
  await streamAudio(
    file,
    ({ sampleRate, frames }) => {
      rate = sampleRate;
      acc = new PeakAccumulator(columns, frames);
    },
    (channels, offset) => {
      acc!.add(channels, offset);
      last = Math.max(last, offset + channels[0]!.length);
    },
  );
  return { peaks: (acc as unknown as PeakAccumulator).peaks, frames: last, rate };
}

describe("streamAudio", () => {
  it("WAV through Mediabunny: every frame, in order, matching a whole decode", async () => {
    const url = new URL("../fixtures/golden/audio/drop-30s-stereo.wav", import.meta.url);
    const wav = readWav16(url);
    const { peaks, frames, rate } = await streamed(new File([readFileSync(url)], "drop.wav"), 50);
    expect(rate).toBe(wav.sampleRate);
    expect(frames).toBe(wav.channels[0]!.length);
    const expected = new PeakAccumulator(50, frames);
    expected.add(wav.channels.map((c) => Float32Array.from(c)), 0);
    expect(Array.from(peaks)).toEqual(Array.from(expected.peaks));
  });

  it("AIFF in 10 s spans: identical to decoding the whole file", async () => {
    const bytes = readFileSync(new URL("../fixtures/media/short-10s-mono.aiff", import.meta.url));
    const whole = decodeAiff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const { peaks, frames } = await streamed(new File([bytes], "short.aiff"), 40);
    expect(frames).toBe(whole.channels[0]!.length);
    const expected = new PeakAccumulator(40, frames);
    expected.add(whole.channels, 0);
    expect(Array.from(peaks)).toEqual(Array.from(expected.peaks));
  });
});
