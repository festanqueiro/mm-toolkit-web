import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeAiff } from "../src/engine/media/aiff";
import { convertJob, NeedsPageDecodeError } from "../src/engine/render/convert";
import { MemorySink } from "../src/io/sink";
import { readWav16 } from "./wav";

const wavUrl = new URL("../fixtures/golden/audio/short-10s-mono.wav", import.meta.url);
const wav = () => new File([readFileSync(wavUrl)], "short-10s-mono.wav");
const aiff = () => new File([readFileSync(new URL("../fixtures/media/short-10s-mono.aiff", import.meta.url))], "short-10s-mono.aiff");
const mp3 = () => new File([readFileSync(new URL("../fixtures/media/tone-4s.mp3", import.meta.url))], "tone-4s.mp3");
const noop = { progress: () => {}, warn: () => {}, cancelled: () => false };
const job = { format: "wav", bitrate: "320k", conflict: "rename" as const };

describe("convertJob", () => {
  it("validates like the desktop", async () => {
    const sink = new MemorySink();
    await expect(convertJob({ ...job, sources: [] }, sink, noop)).rejects.toThrow("Choose at least one media file.");
    await expect(convertJob({ ...job, sources: [wav(), new File([], "a.mp4")] }, sink, noop)).rejects.toThrow(
      "Choose either audio files or video files, not a mixed selection.",
    );
    await expect(convertJob({ ...job, sources: [wav()], format: "mp4" }, sink, noop)).rejects.toThrow("MP4 is not a supported audio output format.");
    await expect(convertJob({ ...job, sources: [wav()], bitrate: "64k" }, sink, noop)).rejects.toThrow("Audio bitrate must be 128k, 192k, 256k, or 320k.");
    await expect(convertJob({ ...job, sources: [new File([], "a.mp4")], format: "avi" }, sink, noop)).rejects.toThrow("AVI output isn't available");
  });

  it("WAV → AIFF and AIFF → WAV: lossless 24-bit, every sample", async () => {
    const source = readWav16(wavUrl);
    const sink = new MemorySink();
    const [toAiff] = await convertJob({ ...job, sources: [wav()], format: "aiff" }, sink, noop);
    expect(toAiff!.name).toBe("short-10s-mono.aiff");
    const back = decodeAiff(await toAiff!.file!.arrayBuffer());
    expect(back.sampleRate).toBe(source.sampleRate);
    expect(Array.from(back.channels[0]!)).toEqual(Array.from(source.channels[0]!, (v) => Math.fround(v)));

    const [toWav] = await convertJob({ ...job, sources: [aiff()], format: "wav" }, sink, noop);
    const bytes = new Uint8Array(await toWav!.file!.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(34, true)).toBe(24);
    expect((bytes.length - 44) / 3).toBe(source.channels[0]!.length);
  });

  it("names `{stem}.{format}` with the conflict policy; converting to the same format is allowed", async () => {
    const sink = new MemorySink();
    const progress: string[] = [];
    const outputs = await convertJob({ ...job, sources: [wav(), wav()] }, sink, { ...noop, progress: (_, s) => progress.push(s) });
    expect(outputs.map((o) => o.name)).toEqual(["short-10s-mono.wav", "short-10s-mono (2).wav"]);
    expect(progress).toContain("Converting short-10s-mono.wav (1 of 2)");
    expect(progress).toContain("Converting short-10s-mono.wav (2 of 2)");
    expect(progress.at(-1)).toBe("Finished 2 conversions");
  });

  it("audio the Worker can't decode: reports the file and what's already done, then resumes from page PCM", async () => {
    const sink = new MemorySink();
    // Node has no WebCodecs, so MP3 can't be decoded here.
    const error = await convertJob({ ...job, sources: [wav(), mp3()] }, sink, noop).catch((e) => e);
    expect(error).toBeInstanceOf(NeedsPageDecodeError);
    expect(error).toMatchObject({ index: 1, sampleRate: 44_100, numberOfChannels: 2 });
    expect(error.outputs.map((o: { name: string }) => o.name)).toEqual(["short-10s-mono.wav"]);
    expect(await sink.exists("tone-4s.wav")).toBe(false);

    const tone = Float32Array.from({ length: 44_100 }, (_, i) => Math.sin(i / 20) * 0.5);
    const resumed = await convertJob({ ...job, sources: [wav(), mp3()], from: 1, pcm: { sampleRate: 44_100, channels: [tone, tone] } }, sink, noop);
    expect(resumed.map((o) => o.name)).toEqual(["tone-4s.wav"]);
  });
});

describe("encode rate", () => {
  it("Opus always 48 kHz; AAC keeps 44.1/48 kHz, else 48 kHz; others keep the source rate", async () => {
    const { encodeRate } = await import("../src/engine/render/transcode");
    expect(encodeRate("opus", 44_100)).toBe(48_000);
    expect(encodeRate("aac", 44_100)).toBe(44_100);
    expect(encodeRate("aac", 48_000)).toBe(48_000);
    expect(encodeRate("aac", 11_025)).toBe(48_000);
    expect(encodeRate("mp3", 22_050)).toBe(22_050);
    expect(encodeRate("flac", 96_000)).toBe(96_000);
    expect(encodeRate("flac", 44_100)).toBe(44_100);
    // Rates the WASM FLAC encoder lacks: an exact multiple, else the next one up.
    expect(encodeRate("flac", 11_025)).toBe(22_050);
    expect(encodeRate("flac", 12_000)).toBe(24_000);
    expect(encodeRate("flac", 37_800)).toBe(44_100);
    expect(encodeRate("flac", 384_000)).toBe(192_000);
  });
});
