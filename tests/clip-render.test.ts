import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeAiff, encodeAiff24 } from "../src/engine/media/aiff";
import { parseStreamInfo } from "../src/engine/media/flac-decoder";
import { cutClipsJob } from "../src/engine/render/clips";
import { CancelledError } from "../src/engine/render/cancel";
import { MemorySink } from "../src/io/sink";

const fixture = (name: string) => new URL(`../fixtures/media/${name}`, import.meta.url);
const aiffFile = () => new File([readFileSync(fixture("short-10s-mono.aiff"))], "short-10s-mono.aiff");
const noop = { progress: () => {}, warn: () => {}, cancelled: () => false };

describe("AIFF 24-bit writer", () => {
  it("round-trips 16-bit content exactly and keeps the sample rate", () => {
    const source = decodeAiff(readFileSync(fixture("short-10s-mono.aiff")).buffer as ArrayBuffer);
    const back = decodeAiff(encodeAiff24(source).buffer as ArrayBuffer);
    expect(back.sampleRate).toBe(source.sampleRate);
    expect(back.channels).toHaveLength(1);
    expect(back.channels[0]).toEqual(source.channels[0]);
  });

  it("writes odd-length sound data with a pad byte and clips out-of-range floats", () => {
    const bytes = encodeAiff24({ sampleRate: 44_100, channels: [new Float32Array([2, -2, 0.5])] });
    expect(bytes.length % 2).toBe(0);
    const back = decodeAiff(bytes.buffer as ArrayBuffer);
    expect(Array.from(back.channels[0]!)).toEqual([8388607 / 8388608, -1, 0.5]);
    expect(back.sampleRate).toBe(44_100);
  });
});

describe("FLAC STREAMINFO", () => {
  const streaminfo = (bits: number) => {
    const info = new Uint8Array(34);
    // 44100 Hz, 2 channels, `bits` per sample.
    const sr = 44_100;
    info[10] = sr >> 12;
    info[11] = (sr >> 4) & 0xff;
    info[12] = ((sr & 0xf) << 4) | (1 << 1) | ((bits - 1) >> 4);
    info[13] = ((bits - 1) & 0xf) << 4;
    return info;
  };
  it("reads bare, block-headed and fLaC-prefixed descriptions", () => {
    expect(parseStreamInfo(streaminfo(16))).toEqual({ sampleRate: 44_100, channels: 2, bitsPerSample: 16 });
    expect(parseStreamInfo(new Uint8Array([0x80, 0, 0, 34, ...streaminfo(24)]))?.bitsPerSample).toBe(24);
    expect(parseStreamInfo(new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34, ...streaminfo(16)]).buffer)?.bitsPerSample).toBe(16);
    expect(parseStreamInfo(undefined)).toBeNull();
    expect(parseStreamInfo(new Uint8Array(3))).toBeNull();
  });
});

describe("cutClipsJob (AIFF path, no WebCodecs needed)", () => {
  it("cuts sample-accurate 24-bit AIFF clips named from the template", async () => {
    const sink = new MemorySink();
    const progress: [number, string][] = [];
    const outputs = await cutClipsJob(
      { source: aiffFile(), clips: [{ title: "", start: 1, duration: 2 }, { title: "Tail", start: 9, duration: 60 }], naming: "{source} - {title}", conflict: "rename" },
      sink,
      { ...noop, progress: (p, s) => progress.push([p, s]) },
    );
    expect(outputs.map((o) => o.name)).toEqual(["short-10s-mono - Clip 01.aiff", "short-10s-mono - Tail.aiff"]);
    const source = decodeAiff(readFileSync(fixture("short-10s-mono.aiff")).buffer as ArrayBuffer);
    const rate = source.sampleRate;
    const first = decodeAiff(await outputs[0]!.file!.arrayBuffer());
    expect(first.channels[0]).toEqual(source.channels[0]!.slice(rate, 3 * rate));
    // Clamped at the end of the source, like FFmpeg `-t` past EOF.
    const tail = decodeAiff(await outputs[1]!.file!.arrayBuffer());
    expect(tail.channels[0]!.length).toBe(source.channels[0]!.length - 9 * rate);
    expect(progress).toEqual([
      [0, "Creating clip 1 of 2"],
      [50, "Creating clip 2 of 2"],
      [100, "Finished 2 clips"],
    ]);
  });

  it("validates like the desktop", async () => {
    const sink = new MemorySink();
    const job = { source: aiffFile(), clips: [{ title: "", start: 0, duration: 1 }], naming: "{source} - {title}", conflict: "rename" as const };
    await expect(cutClipsJob({ ...job, clips: [] }, sink, noop)).rejects.toThrow("Add at least one clip.");
    await expect(cutClipsJob({ ...job, source: new File([], "notes.txt") }, sink, noop)).rejects.toThrow("Choose a supported audio or video source.");
    await expect(cutClipsJob({ ...job, clips: [{ title: "", start: 0, duration: 0 }] }, sink, noop)).rejects.toThrow("Clip 1 has an invalid start or duration.");
    await expect(cutClipsJob({ ...job, naming: "{track}" }, sink, noop)).rejects.toThrow("Invalid clip naming template. Use {source}, {title}, and {number}.");
    await expect(cutClipsJob({ ...job, clips: [{ title: "", start: 10, duration: 1 }] }, sink, noop)).rejects.toThrow(
      "Clip 1 starts after the end of short-10s-mono.aiff.",
    );
    expect(await sink.exists("short-10s-mono - Clip 01.aiff")).toBe(false);
  });

  it("skip leaves existing outputs alone; cancel stops before the next clip", async () => {
    const sink = new MemorySink();
    const job = { source: aiffFile(), clips: [{ title: "A", start: 0, duration: 1 }], naming: "{title}", conflict: "skip" as const };
    expect(await cutClipsJob(job, sink, noop)).toHaveLength(1);
    expect(await cutClipsJob(job, sink, noop)).toEqual([]);
    await expect(cutClipsJob(job, sink, { ...noop, cancelled: () => true })).rejects.toBeInstanceOf(CancelledError);
  });
});
