import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from "mediabunny";
import { decodeFlacFrame, parseStreamInfo } from "../src/engine/media/flac-decoder";
import { readWav16 } from "./wav";

const golden = (name: string) => new URL(`../fixtures/golden/audio/${name}`, import.meta.url);
const media = (name: string) => new URL(`../fixtures/media/${name}`, import.meta.url);

/** Demux with Mediabunny (no WebCodecs needed) and decode every frame with the TS decoder. */
async function decodeFile(name: string) {
  const input = new Input({ source: new BufferSource(readFileSync(media(name))), formats: ALL_FORMATS });
  const track = (await input.getPrimaryAudioTrack())!;
  const info = parseStreamInfo((await track.getDecoderConfig())?.description);
  const planes: number[][] = [];
  let bits = 0;
  for await (const packet of new EncodedPacketSink(track).packets()) {
    const frame = decodeFlacFrame(packet.data, info);
    bits = frame.bitsPerSample;
    frame.channels.forEach((plane, c) => (planes[c] ??= []).push(...plane));
  }
  return { info, bits, planes };
}

/** The golden WAV slice as integers at `bits` resolution. */
function reference(name: string, startSeconds: number, seconds: number, bits: number) {
  const wav = readWav16(golden(name));
  const from = startSeconds * wav.sampleRate;
  return wav.channels.map((c) => Array.from(c.subarray(from, from + seconds * wav.sampleRate), (v) => Math.round(v * 32768) * 2 ** (bits - 16)));
}

describe("TS FLAC decoder (lossless: bit-exact against the source WAV)", () => {
  it("16-bit stereo music (LPC, stereo decorrelation)", async () => {
    const { info, bits, planes } = await decodeFile("drop-3s-stereo.flac");
    expect(info).toEqual({ sampleRate: readWav16(golden("drop-30s-stereo.wav")).sampleRate, channels: 2, bitsPerSample: 16 });
    expect(bits).toBe(16);
    expect(planes).toEqual(reference("drop-30s-stereo.wav", 26, 3, 16));
  });

  it("24-bit stereo (wasted bits)", async () => {
    const { bits, planes } = await decodeFile("drop-1s-stereo-24.flac");
    expect(bits).toBe(24);
    expect(planes).toEqual(reference("drop-30s-stereo.wav", 26, 1, 24));
  });

  it("16-bit mono, fastest compression (fixed predictors)", async () => {
    const { planes } = await decodeFile("short-2s-mono.flac");
    expect(planes).toEqual(reference("short-10s-mono.wav", 0, 2, 16));
  });

  it("rejects data without a frame sync code", () => {
    expect(() => decodeFlacFrame(new Uint8Array([0, 1, 2, 3]), null)).toThrow("Missing FLAC frame sync code.");
  });
});
