import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectDropTime, toMono } from "../src/engine/analysis/drop";
import { decodeAiff } from "../src/engine/media/aiff";
import { AudioDecodeError, decodeAudio, normaliseStereo16 } from "../src/engine/media/audio-decode";
import { golden, goldenFile } from "./golden";
import { readWav16 } from "./wav";

const fileFrom = (url: URL, name: string) => new File([readFileSync(url)], name);
const media = (name: string) => new URL(`../fixtures/media/${name}`, import.meta.url);

describe("decodeAudio (Mediabunny / AIFF reader)", () => {
  it.each(golden.audio.tracks.map((t) => [t.file, t] as const))("%s: native rate, stereo, samples match soundfile", async (file, track) => {
    const pcm = await decodeAudio(fileFrom(goldenFile(file), file.split("/").pop()!));
    const reference = readWav16(goldenFile(file));
    expect(pcm.sampleRate).toBe(track.sampleRate);
    expect(pcm.channels).toHaveLength(2);
    expect(pcm.channels[0]!.length).toBe(reference.channels[0]!.length);
    for (const c of [0, 1]) {
      const ref = reference.channels[Math.min(c, reference.channels.length - 1)]!;
      for (let i = 0; i < ref.length; i += 997) expect(pcm.channels[c]![i]).toBe(Math.fround(ref[i]!));
    }
  });

  it.each(golden.audio.tracks.map((t) => [t.file, t] as const))("%s: drop detection through the decoder matches the desktop", async (file, track) => {
    const pcm = await decodeAudio(fileFrom(goldenFile(file), file.split("/").pop()!));
    expect(detectDropTime(toMono(pcm.channels), pcm.sampleRate)).toBe(track.detectDropTime);
  });

  it("decodes a range", async () => {
    const pcm = await decodeAudio(fileFrom(goldenFile("audio/drop-30s-stereo.wav"), "drop-30s-stereo.wav"), { start: 2, duration: 1.5 });
    const reference = readWav16(goldenFile("audio/drop-30s-stereo.wav"));
    expect(pcm.channels[0]!.length).toBe(Math.round(1.5 * 11025));
    expect(pcm.channels[1]![100]).toBe(Math.fround(reference.channels[1]![2 * 11025 + 100]!));
  });

  it("AIFF (big-endian PCM) decodes identically to the WAV it came from", async () => {
    const aiff = await decodeAudio(fileFrom(media("short-10s-mono.aiff"), "short-10s-mono.aiff"));
    const wav = await decodeAudio(fileFrom(goldenFile("audio/short-10s-mono.wav"), "short-10s-mono.wav"));
    expect(aiff.sampleRate).toBe(11025);
    expect(aiff.channels[0]!.length).toBe(wav.channels[0]!.length);
    expect(Array.from(aiff.channels[0]!.subarray(0, 5000))).toEqual(Array.from(wav.channels[0]!.subarray(0, 5000)));
  });

  it("rejects non-audio bytes", async () => {
    await expect(decodeAudio(new File([new Uint8Array(64)], "noise.mp3"))).rejects.toBeInstanceOf(AudioDecodeError);
    await expect(decodeAudio(new File([new Uint8Array(64)], "noise.aiff"))).rejects.toMatchObject({ kind: "unreadable" });
  });
});

describe("AIFF reader", () => {
  function aiff(bits: number, samples: number[], compression?: string): ArrayBuffer {
    const bytes = bits / 8;
    const commSize = compression ? 24 : 18;
    const dataSize = 8 + samples.length * bytes;
    const total = 4 + 8 + commSize + 8 + dataSize;
    const view = new DataView(new ArrayBuffer(8 + total));
    const ascii = (at: number, text: string) => [...text].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
    ascii(0, "FORM");
    view.setUint32(4, total);
    ascii(8, compression ? "AIFC" : "AIFF");
    ascii(12, "COMM");
    view.setUint32(16, commSize);
    view.setInt16(20, 1);
    view.setUint32(22, samples.length);
    view.setInt16(26, bits);
    // 44100 as 80-bit extended: exponent 16383+15, mantissa 44100 << 48.
    view.setUint16(28, 16383 + 15);
    view.setUint32(30, 44100 * 2 ** 16);
    if (compression) ascii(38, compression);
    const ssnd = 20 + commSize;
    ascii(ssnd, "SSND");
    view.setUint32(ssnd + 4, dataSize);
    samples.forEach((s, i) => {
      const at = ssnd + 16 + i * bytes;
      if (bits === 24) {
        const v = s < 0 ? s + 0x1000000 : s;
        view.setUint8(at, v >> 16);
        view.setUint8(at + 1, (v >> 8) & 0xff);
        view.setUint8(at + 2, v & 0xff);
      } else if (compression === "sowt") view.setInt16(at, s, true);
      else view.setInt16(at, s);
    });
    return view.buffer;
  }

  it("reads 16-bit, 24-bit and sowt PCM with soundfile scaling", () => {
    expect(decodeAiff(aiff(16, [16384, -32768])).channels[0]).toEqual(Float32Array.from([0.5, -1]));
    expect(decodeAiff(aiff(16, [16384, -32768])).sampleRate).toBe(44100);
    expect(decodeAiff(aiff(24, [4194304, -8388608])).channels[0]).toEqual(Float32Array.from([0.5, -1]));
    expect(decodeAiff(aiff(16, [16384, -16384], "sowt")).channels[0]).toEqual(Float32Array.from([0.5, -0.5]));
  });
});

describe("normaliseStereo16", () => {
  it("duplicates mono and quantises to 16-bit like pcm_s16le", () => {
    const out = normaliseStereo16({ sampleRate: 8000, channels: [Float32Array.from([0.1, 1.5, -2])] });
    expect(out.channels).toHaveLength(2);
    expect(out.channels[0]).toBe(out.channels[1]);
    expect(Array.from(out.channels[0]!)).toEqual([Math.fround(Math.round(0.1 * 32768) / 32768), Math.fround(32767 / 32768), -1]);
  });
});

describe("AIFF range decoding (reads only the span it needs)", () => {
  it("matches slicing the whole decode, and reads few bytes", async () => {
    const { readFileSync } = await import("node:fs");
    const { decodeAiff, decodeAiffBlob } = await import("../src/engine/media/aiff");
    const bytes = readFileSync(new URL("../fixtures/media/short-10s-mono.aiff", import.meta.url));
    const whole = decodeAiff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const blob = new Blob([bytes]);
    let read = 0;
    const counting = {
      size: blob.size,
      slice: (a?: number, b?: number) => {
        read += Math.min(b ?? blob.size, blob.size) - (a ?? 0);
        return blob.slice(a, b);
      },
    } as Blob;
    const part = await decodeAiffBlob(counting, { start: 2, duration: 0.5 });
    const rate = whole.sampleRate;
    expect(part.sampleRate).toBe(rate);
    expect(part.channels[0]).toEqual(whole.channels[0]!.slice(Math.round(2 * rate), Math.round(2.5 * rate)));
    expect(read).toBeLessThan(0.5 * rate * 2 + 1024);
    // Past the end: empty, not an error.
    expect((await decodeAiffBlob(blob, { start: 60, duration: 1 })).channels[0]!.length).toBe(0);
  });
});
