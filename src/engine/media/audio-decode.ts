/**
 * Decode audio to planar float32 PCM at the file's native sample rate, normalised like the
 * desktop's FFmpeg step (`-ac 2 -c:a pcm_s16le`, spec 02): stereo, 16-bit quantised.
 * Runs in Workers (no DOM). AIFF goes through the TS reader; everything else through
 * Mediabunny (WebCodecs `AudioDecoder` for compressed codecs).
 */

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type InputAudioTrack } from "mediabunny";
import { extensionOf } from "../media-kind";
import { decodeAiff, isAiff, type PcmAudio } from "./aiff";
import { registerFlacDecoder } from "./flac-decoder";

registerFlacDecoder();

export type { PcmAudio };

/** `unsupported`: this browser can't decode the codec here (callers may try another path). */
export class AudioDecodeError extends Error {
  constructor(
    message: string,
    readonly kind: "unreadable" | "unsupported" | "empty",
  ) {
    super(message);
  }
}

export type DecodeRange = { start: number; duration: number };

/**
 * FFmpeg `-ac 2`: mono is duplicated, stereo passes through. More channels: best effort,
 * keep front left/right. Then `pcm_s16le` quantisation (read back as `x / 32768`).
 */
export function normaliseStereo16(pcm: PcmAudio): PcmAudio {
  const left = pcm.channels[0];
  const right = pcm.channels[1] ?? left;
  if (!left || !right) throw new AudioDecodeError("contains no usable audio", "empty");
  const quantise = (plane: Float32Array) => {
    const out = new Float32Array(plane.length);
    for (let i = 0; i < plane.length; i++) {
      const v = Math.round(plane[i]! * 32768);
      out[i] = (v > 32767 ? 32767 : v < -32768 ? -32768 : v) / 32768;
    }
    return out;
  };
  const l = quantise(left);
  return { sampleRate: pcm.sampleRate, channels: [l, right === left ? l : quantise(right)] };
}

function slice(pcm: PcmAudio, range?: DecodeRange): PcmAudio {
  if (!range) return pcm;
  const from = Math.max(0, Math.round(range.start * pcm.sampleRate));
  const to = Math.max(from, Math.round((range.start + range.duration) * pcm.sampleRate));
  return { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice(from, to)) };
}

/**
 * Whether `track` really decodes in this engine: `canDecode()`, then the first sample must
 * arrive within `timeoutMs`. Some engines report support and then fail or never produce a
 * sample (WebKitGTK's GStreamer Vorbis decoder hangs), which `canDecode()` can't reveal.
 */
export let lastProbe = "";
export async function decodesHere(track: InputAudioTrack, timeoutMs = 4000): Promise<boolean> {
  const t0 = performance.now();
  if (!(await track.canDecode())) return false;
  const samples = new AudioSampleSink(track).samples();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      samples.next().then(
        (result) => {
          lastProbe = `done=${result.done} after ${Math.round(performance.now() - t0)}ms`;
          result.value?.close();
          return !result.done;
        },
        (e) => {
          lastProbe = `error ${e} after ${Math.round(performance.now() - t0)}ms`;
          return false;
        },
      ),
      new Promise<boolean>((resolve) => (timer = setTimeout(() => {
        lastProbe = `timeout after ${Math.round(performance.now() - t0)}ms`;
        resolve(false);
      }, timeoutMs))),
    ]);
  } finally {
    clearTimeout(timer);
    // Don't await: a hung decoder may never settle.
    void samples.return(undefined).catch(() => {});
  }
}

async function decodeWithMediabunny(blob: Blob, range?: DecodeRange): Promise<PcmAudio> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    let track;
    try {
      track = await input.getPrimaryAudioTrack();
    } catch {
      throw new AudioDecodeError("could not be read", "unreadable");
    }
    if (!track) throw new AudioDecodeError("contains no usable audio", "empty");
    if (!(await decodesHere(track))) throw new AudioDecodeError(`uses a codec (${track.codec ?? "unknown"}) this browser can't decode`, "unsupported");
    const sampleRate = track.sampleRate;
    const count = track.numberOfChannels;
    const start = range?.start ?? 0;
    const end = range ? range.start + range.duration : Infinity;
    const chunks: { offset: number; planes: Float32Array[] }[] = [];
    let total = 0;
    for await (const sample of new AudioSampleSink(track).samples(start, end)) {
      const offset = Math.round((sample.timestamp - start) * sampleRate);
      const skip = Math.max(0, -offset);
      const limit = range ? Math.round(range.duration * sampleRate) : Infinity;
      const frames = Math.min(sample.numberOfFrames - skip, limit - Math.max(0, offset));
      if (frames > 0) {
        const planes = [];
        for (let c = 0; c < count; c++) {
          const plane = new Float32Array(sample.numberOfFrames);
          sample.copyTo(plane, { planeIndex: c, format: "f32-planar" });
          planes.push(plane.subarray(skip, skip + frames));
        }
        chunks.push({ offset: Math.max(0, offset), planes });
        total = Math.max(total, Math.max(0, offset) + frames);
      }
      sample.close();
    }
    const channels = Array.from({ length: count }, () => new Float32Array(total));
    for (const chunk of chunks) chunk.planes.forEach((plane, c) => channels[c]!.set(plane, chunk.offset));
    return { sampleRate, channels };
  } finally {
    input.dispose();
  }
}

/** Decode `blob` (optionally only `[start, start + duration)`), normalised to 16-bit stereo. */
export async function decodeAudio(blob: Blob, range?: DecodeRange): Promise<PcmAudio> {
  const name = (blob as File).name ?? "";
  let pcm: PcmAudio;
  const ext = extensionOf(name);
  if (ext === ".aif" || ext === ".aiff" || (!ext && isAiff(await blob.slice(0, 12).arrayBuffer()))) {
    try {
      pcm = slice(decodeAiff(await blob.arrayBuffer()), range);
    } catch (error) {
      throw new AudioDecodeError((error as Error).message || "could not be read", "unreadable");
    }
  } else {
    pcm = await decodeWithMediabunny(blob, range);
  }
  if (!pcm.channels[0]?.length) throw new AudioDecodeError("contains no usable audio", "empty");
  return normaliseStereo16(pcm);
}
