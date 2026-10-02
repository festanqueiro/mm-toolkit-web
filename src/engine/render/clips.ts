/**
 * Clip cutting: port of `core.cut_media_clips` (spec 05). Runs in a Worker. Every clip is
 * re-encoded like the desktop (frame-accurate, never stream-copied): video → H.264 + AAC
 * MP4, audio → the source's own format. Mediabunny's `Conversion` streams decode → trim →
 * encode; AIFF (no Mediabunny demuxer) is sliced and written in TS. Clips run sequentially.
 */
import {
  ALL_FORMATS,
  AdtsOutputFormat,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  Conversion,
  ConversionCanceledError,
  FlacOutputFormat,
  getFirstEncodableVideoCodec,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  WavOutputFormat,
  type AudioCodec,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type DiscardedTrack,
  type OutputFormat,
} from "mediabunny";
import { clipOutputFormat, clipOutputName, type ClipFormat, type ClipRequest } from "../clips";
import { decodeAiff, encodeAiff24, type PcmAudio } from "../media/aiff";
import { decodesHere } from "../media/audio-decode";
import { parseStreamInfo, registerFlacDecoder } from "../media/flac-decoder";
import { mediaKind } from "../media-kind";
import type { ConflictPolicy } from "../naming";
import { videoBitrate } from "../video-creator";
import type { OutputRef, OutputSink } from "../../io/sink";
import { CancelledError } from "./cancel";

/**
 * `pcm`: the whole source decoded at its native rate by the page (Web Audio), for audio this
 * engine's Worker can't decode (see `UndecodableAudioError`).
 */
export type ClipJob = { source: File; clips: ClipRequest[]; naming: string; conflict: ConflictPolicy; pcm?: PcmAudio };

/**
 * The source's audio doesn't decode in this Worker. Carries what the page needs to decode it
 * with Web Audio at the native rate and retry with `ClipJob.pcm`.
 */
export class UndecodableAudioError extends Error {
  constructor(
    name: string,
    codec: string | null,
    readonly sampleRate: number,
    readonly numberOfChannels: number,
  ) {
    super(`${name} uses a codec (${codec ?? "unknown"}) this browser can't decode.`);
  }
}

export type ClipCallbacks = {
  progress: (percent: number, status: string) => void;
  warn: (message: string) => void;
  cancelled: () => boolean;
};

registerFlacDecoder();

/** Desktop: AAC 256 kbps in video clips, 320 kbps for audio clips. */
const VIDEO_AUDIO_BITRATE = 256_000;
const AUDIO_BITRATE = 320_000;
/** Ogg Vorbis q8 averages ~256 kbps; Opus stands in until ADR-003 decides (no Vorbis encoder on the web). */
const OGG_OPUS_BITRATE = 256_000;

/** Cut every clip; returns the outputs written (skipped clips produce none). */
export async function cutClipsJob(job: ClipJob, sink: OutputSink, cb: ClipCallbacks): Promise<OutputRef[]> {
  if (!job.clips.length) throw new Error("Add at least one clip.");
  const format = clipOutputFormat(job.source.name);
  const kind = mediaKind(job.source.name);
  if (!format || !kind) throw new Error("Choose a supported audio or video source.");
  const n = job.clips.length;
  const outputs: OutputRef[] = [];
  for (const [index, clip] of job.clips.entries()) {
    if (cb.cancelled()) throw new CancelledError();
    if (clip.start < 0 || !(clip.duration > 0)) throw new Error(`Clip ${index + 1} has an invalid start or duration.`);
    const requested = clipOutputName(job.naming, job.source.name, clip.title, index, format);
    const name = await sink.resolveName(requested, job.conflict);
    if (name === null) continue; // "skip": an output with this name exists.
    const status = `Creating clip ${index + 1} of ${n}`;
    cb.progress(Math.round((index / n) * 100), status);
    try {
      const onFraction = (fraction: number) => {
        cb.progress(Math.round(((index + Math.min(1, fraction)) / n) * 100), status);
      };
      const bytes =
        job.pcm && format !== "mp4" && format !== "aiff"
          ? await cutPcm(job.pcm, clip, index, job.source.name, format, cb, onFraction)
          : await cutClip(job.source, clip, index, format, cb, onFraction);
      const writer = (await sink.create(name)).getWriter();
      await writer.write(bytes);
      await writer.close();
      outputs.push(await sink.complete(name));
    } catch (error) {
      await sink.remove(name).catch(() => {});
      throw error;
    }
  }
  cb.progress(100, `Finished ${outputs.length} clip${outputs.length === 1 ? "" : "s"}`);
  return outputs;
}

const pastEnd = (index: number, name: string) => new Error(`Clip ${index + 1} starts after the end of ${name}.`);

async function cutClip(
  source: File,
  clip: ClipRequest,
  index: number,
  format: ClipFormat,
  cb: ClipCallbacks,
  onFraction: (fraction: number) => void,
): Promise<Uint8Array> {
  if (format === "aiff") return cutAiff(source, clip, index);
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  try {
    let duration: number;
    try {
      duration = await input.computeDuration();
    } catch (error) {
      throw new Error(`${source.name} could not be read.`, { cause: error });
    }
    if (clip.start >= duration) throw pastEnd(index, source.name);
    const output = new Output({ format: outputFormat(format), target: new BufferTarget() });
    const options = format === "mp4" ? await videoOptions(input, source.name, cb) : await audioOptions(input, source.name, format);
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      trim: { start: clip.start, end: Math.min(duration, clip.start + clip.duration) },
      ...options,
      showWarnings: false,
    });
    assertUsable(conversion, source.name, format === "mp4" ? "video" : "audio");
    conversion.onProgress = (progress) => {
      if (cb.cancelled()) void conversion.cancel();
      else onFraction(progress);
    };
    try {
      await conversion.execute();
    } catch (error) {
      if (error instanceof ConversionCanceledError || cb.cancelled()) throw new CancelledError();
      throw error;
    }
    return new Uint8Array(output.target.buffer!);
  } finally {
    input.dispose();
  }
}

function outputFormat(format: Exclude<ClipFormat, "aiff">): OutputFormat {
  switch (format) {
    case "mp4":
    case "m4a":
      return new Mp4OutputFormat({ fastStart: "in-memory" });
    case "mp3":
      return new Mp3OutputFormat();
    case "wav":
      return new WavOutputFormat();
    case "flac":
      return new FlacOutputFormat();
    case "aac":
      return new AdtsOutputFormat();
    case "ogg":
      return new OggOutputFormat();
  }
}

/**
 * Register a Mediabunny WASM encoder once. MP3 (LAME, as desktop FFmpeg) and FLAC always use
 * WASM: no native encoder is trustworthy for them (WebKitGTK's GStreamer ones claim support
 * and write broken files). AAC only falls back to WASM when there's no native encoder.
 */
const registered = new Set<string>();
async function ensureEncoder(codec: AudioCodec): Promise<void> {
  if (registered.has(codec) || !["aac", "mp3", "flac"].includes(codec)) return;
  registered.add(codec);
  if (codec === "mp3") (await import("@mediabunny/mp3-encoder")).registerMp3Encoder();
  else if (codec === "flac") (await import("@mediabunny/flac-encoder")).registerFlacEncoder();
  else if (!(await canEncodeAudio(codec))) (await import("@mediabunny/aac-encoder")).registerAacEncoder();
}

type TrackOptions = { video: ConversionVideoOptions; audio: ConversionAudioOptions };

/** First video stream re-encoded to H.264 (High quality preset), optional AAC 256k audio. */
async function videoOptions(input: Input, name: string, cb: ClipCallbacks): Promise<TrackOptions> {
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error(`${name} contains no usable video.`);
  const width = video.displayWidth - (video.displayWidth % 2);
  const height = video.displayHeight - (video.displayHeight % 2);
  const fps = (await video.computePacketStats(100).catch(() => null))?.averagePacketRate || 30;
  const bitrate = videoBitrate([width, height], Math.min(fps, 120), "high");
  const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width, height, bitrate });
  if (!codec) throw new Error(`This browser can't encode ${width} × ${height} video.`);
  if (codec !== "avc") cb.warn(`This browser can't encode H.264 here, so the video uses ${codec.toUpperCase()} in MP4.`);
  const odd = width !== video.displayWidth || height !== video.displayHeight;
  const audio = await input.getPrimaryAudioTrack();
  const audioOk = !!audio && (await decodesHere(audio));
  if (audioOk) await ensureEncoder("aac");
  else if (audio) cb.warn(`${name} has audio this browser can't decode, so the clips are silent.`);
  return {
    video: { codec, bitrate, forceTranscode: true, ...(odd ? { width, height, fit: "fill" as const } : {}) },
    audio: audioOk ? { codec: "aac", bitrate: VIDEO_AUDIO_BITRATE, forceTranscode: true } : { discard: true },
  };
}

type AudioFormat = Exclude<ClipFormat, "mp4" | "aiff">;

/** The desktop's codec settings per audio format (OGG: Opus until ADR-003). */
function audioEncoding(format: AudioFormat): { codec: AudioCodec; bitrate?: number } {
  switch (format) {
    case "mp3":
      return { codec: "mp3", bitrate: AUDIO_BITRATE };
    case "m4a":
    case "aac":
      return { codec: "aac", bitrate: AUDIO_BITRATE };
    case "wav":
      return { codec: "pcm-s24" };
    case "flac":
      return { codec: "flac" };
    case "ogg":
      return { codec: "opus", bitrate: OGG_OPUS_BITRATE };
  }
}

/** Audio keeps its format, re-encoded with the desktop's settings; video streams are dropped. */
async function audioOptions(input: Input, name: string, format: AudioFormat): Promise<TrackOptions> {
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error(`${name} contains no usable audio.`);
  if (!(await decodesHere(track))) throw new UndecodableAudioError(name, track.codec, track.sampleRate, track.numberOfChannels);
  const audio: ConversionAudioOptions = { forceTranscode: true, ...audioEncoding(format) };
  if (format === "flac") {
    // FFmpeg keeps a 16-bit FLAC 16-bit; the encoder picks 16 vs 24 from the sample format.
    const config = await track.getDecoderConfig().catch(() => null);
    if (parseStreamInfo(config?.description)?.bitsPerSample === 16) audio.sampleFormat = "s16";
  }
  await ensureEncoder(audio.codec!);
  return { video: { discard: true }, audio };
}

/** Encode `[start, start + duration)` of page-decoded PCM (the Web Audio fallback). */
async function cutPcm(
  pcm: PcmAudio,
  clip: ClipRequest,
  index: number,
  name: string,
  format: AudioFormat,
  cb: ClipCallbacks,
  onFraction: (fraction: number) => void,
): Promise<Uint8Array> {
  const frames = pcm.channels[0]?.length ?? 0;
  const from = Math.round(clip.start * pcm.sampleRate);
  if (from >= frames) throw pastEnd(index, name);
  const to = Math.min(frames, Math.round((clip.start + clip.duration) * pcm.sampleRate));
  const encoding = audioEncoding(format);
  await ensureEncoder(encoding.codec);
  const output = new Output({ format: outputFormat(format), target: new BufferTarget() });
  const source = new AudioSampleSource(encoding);
  output.addAudioTrack(source);
  await output.start();
  try {
    // One-second chunks keep progress and cancel responsive.
    const chunk = pcm.sampleRate;
    for (let at = from; at < to; at += chunk) {
      if (cb.cancelled()) throw new CancelledError();
      const end = Math.min(to, at + chunk);
      const data = new Float32Array((end - at) * pcm.channels.length);
      pcm.channels.forEach((plane, c) => data.set(plane.subarray(at, end), c * (end - at)));
      const sample = new AudioSample({ data, format: "f32-planar", numberOfChannels: pcm.channels.length, sampleRate: pcm.sampleRate, timestamp: (at - from) / pcm.sampleRate });
      await source.add(sample);
      sample.close();
      onFraction((end - from) / (to - from));
    }
    source.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  }
  return new Uint8Array(output.target.buffer!);
}

/** Turn Mediabunny's discard reasons for the track we need into the user-facing error. */
function assertUsable(conversion: Conversion, name: string, type: "video" | "audio"): void {
  const used = conversion.utilizedTracks.some((track) => track.type === type);
  if (used && conversion.isValid) return;
  const discarded: DiscardedTrack | undefined = conversion.discardedTracks.find((d) => d.track.type === type && d.reason !== "discarded_by_user");
  switch (discarded?.reason) {
    case "undecodable_source_codec":
    case "unknown_source_codec":
      throw new Error(`${name} uses a codec (${discarded.track.codec ?? "unknown"}) this browser can't decode.`);
    case "no_encodable_target_codec":
      throw new Error(`This browser can't encode this ${type} format.`);
    default:
      throw new Error(`${name} contains no usable ${type}.`);
  }
}

/** AIFF → AIFF: slice the decoded PCM and write 24-bit big-endian (FFmpeg `pcm_s24be`). */
async function cutAiff(source: File, clip: ClipRequest, index: number): Promise<Uint8Array> {
  let pcm;
  try {
    pcm = decodeAiff(await source.arrayBuffer());
  } catch (error) {
    throw new Error(`${source.name} could not be read.`, { cause: error });
  }
  const frames = pcm.channels[0]?.length ?? 0;
  const from = Math.round(clip.start * pcm.sampleRate);
  if (from >= frames) throw pastEnd(index, source.name);
  const to = Math.min(frames, Math.round((clip.start + clip.duration) * pcm.sampleRate));
  return encodeAiff24({ sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.subarray(from, to)) });
}
