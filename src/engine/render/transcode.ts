/**
 * One file → one re-encoded output, optionally trimmed: the shared engine of the Media Cutter
 * (`cut_media_clips`) and the Media Converter (`convert_media`). Runs in a Worker.
 *
 * Two routes:
 * - Mediabunny `Conversion` when it can read the source and write the target (streams decode →
 *   trim → encode → mux), guarded by a stall watchdog.
 * - A PCM pipeline otherwise: AIFF sources (no Mediabunny demuxer), AIFF targets (no muxer),
 *   and audio the page decoded with Web Audio. PCM is streamed in short spans.
 */
import {
  ALL_FORMATS,
  AdtsOutputFormat,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  Conversion,
  ConversionCanceledError,
  FlacOutputFormat,
  getFirstEncodableVideoCodec,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  WavOutputFormat,
  WebMOutputFormat,
  type AudioCodec,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type DiscardedTrack,
  type OutputFormat,
  type VideoCodec,
} from "mediabunny";
import { StreamResampler } from "../audio/resample";
import { blobReader, decodeAiffBlob, encodeAiff24, isAiff, readAiffLayout, type PcmAudio } from "../media/aiff";
import { DECODE_STALL_MS } from "../media/audio-decode";
import { parseStreamInfo, registerFlacDecoder } from "../media/flac-decoder";
import { extensionOf } from "../media-kind";
import { videoBitrate, type Quality } from "../video-creator";
import { CancelledError } from "./cancel";

registerFlacDecoder();

export type AudioFormat = "mp3" | "wav" | "aiff" | "flac" | "m4a" | "aac" | "ogg";
export type VideoFormat = "mp4" | "mov" | "mkv" | "webm";

/** `bitrate` applies to the lossy audio formats (MP3, M4A/AAC, OGG). */
export type Target = { kind: "audio"; format: AudioFormat; bitrate: number } | { kind: "video"; format: VideoFormat };

export type JobCallbacks = {
  progress: (percent: number, status: string) => void;
  warn: (message: string) => void;
  cancelled: () => boolean;
};

export type TranscodeOptions = {
  /** Seconds of the source to keep; the whole file when absent. */
  trim?: { start: number; duration: number };
  /** The whole source decoded by the page at its native rate (see `UndecodableAudioError`). */
  pcm?: PcmAudio;
  cb: JobCallbacks;
  onFraction: (fraction: number) => void;
};

/**
 * The source's audio doesn't decode in this Worker. Carries what the page needs to decode it
 * with Web Audio at the native rate and retry with `pcm`.
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

/** The trim starts at or after the end of the source. */
export class StartPastEndError extends Error {}

const isAiffSource = async (file: File) => {
  const ext = extensionOf(file.name);
  return ext === ".aif" || ext === ".aiff" || (!ext && isAiff(await file.slice(0, 12).arrayBuffer()));
};

export async function transcode(source: File, target: Target, options: TranscodeOptions): Promise<Uint8Array> {
  if (target.kind === "audio" && (options.pcm || target.format === "aiff" || (await isAiffSource(source)))) {
    return pcmPipeline(await pcmSource(source, options), target, options);
  }
  return convert(source, target, options);
}

// ------------------------------------------------------------------ Encoders & formats

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

function outputFormat(format: Exclude<AudioFormat, "aiff"> | VideoFormat): OutputFormat {
  switch (format) {
    case "mp4":
    case "m4a":
      return new Mp4OutputFormat({ fastStart: "in-memory" });
    case "mov":
      return new MovOutputFormat({ fastStart: "in-memory" });
    case "mkv":
      return new MkvOutputFormat();
    case "webm":
      return new WebMOutputFormat();
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
 * The rate to encode at. Opus is defined at 48 kHz, and native encoders misbehave at unusual
 * rates (WebKit's Opus fails at 11.025 kHz; its AAC writes an explicit-frequency config that
 * ADTS can't carry), so Opus is always 48 kHz and AAC keeps only 44.1/48 kHz sources' rates.
 */
const OPUS_RATE = 48_000;
export function encodeRate(codec: AudioCodec, sourceRate: number): number {
  if (codec === "opus") return OPUS_RATE;
  if (codec === "aac" && sourceRate !== 44_100 && sourceRate !== 48_000) return 48_000;
  return sourceRate;
}

/** Audio codec per format. OGG is Opus until ADR-003 (no Vorbis encoder on the web). */
function audioEncoding(target: Extract<Target, { kind: "audio" }>): { codec: AudioCodec; bitrate?: number } {
  switch (target.format) {
    case "mp3":
      return { codec: "mp3", bitrate: target.bitrate };
    case "m4a":
    case "aac":
      return { codec: "aac", bitrate: target.bitrate };
    case "wav":
      return { codec: "pcm-s24" };
    case "aiff":
      return { codec: "pcm-s24be" };
    case "flac":
      return { codec: "flac" };
    case "ogg":
      return { codec: "opus", bitrate: target.bitrate };
  }
}

/**
 * Video settings per container (desktop: H.264 CRF 18 + AAC 256k; WebM: VP9 CRF 28 + Opus 192k).
 * Quality presets stand in for CRF (spec 04): High for H.264, Standard for WebM.
 */
const VIDEO_TARGETS: Record<VideoFormat, { codecs: VideoCodec[]; quality: Quality; audio: { codec: AudioCodec; bitrate: number } }> = {
  mp4: { codecs: ["avc", "vp9", "av1"], quality: "high", audio: { codec: "aac", bitrate: 256_000 } },
  mov: { codecs: ["avc", "vp9", "av1"], quality: "high", audio: { codec: "aac", bitrate: 256_000 } },
  mkv: { codecs: ["avc", "vp9", "av1"], quality: "high", audio: { codec: "aac", bitrate: 256_000 } },
  webm: { codecs: ["vp9", "av1", "vp8"], quality: "standard", audio: { codec: "opus", bitrate: 192_000 } },
};

const CODEC_NAMES: Partial<Record<VideoCodec, string>> = { avc: "H.264", vp9: "VP9", av1: "AV1", vp8: "VP8" };

// ------------------------------------------------------------------ Mediabunny route

type TrackOptions = { video: ConversionVideoOptions; audio: ConversionAudioOptions };

async function convert(source: File, target: Target, options: TranscodeOptions, silent = false): Promise<Uint8Array> {
  const { cb, trim } = options;
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  try {
    let duration: number;
    try {
      duration = await input.computeDuration();
    } catch (error) {
      throw new Error(`${source.name} could not be read.`, { cause: error });
    }
    if (trim && trim.start >= duration) throw new StartPastEndError();
    const output = new Output({ format: outputFormat(target.format as Exclude<AudioFormat, "aiff"> | VideoFormat), target: new BufferTarget() });
    const tracks = target.kind === "video" ? await videoOptions(input, source.name, target.format, cb, silent) : await audioOptions(input, source.name, target);
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      ...(trim ? { trim: { start: trim.start, end: Math.min(duration, trim.start + trim.duration) } } : {}),
      ...tracks,
      showWarnings: false,
    });
    assertUsable(conversion, source.name, target.kind);
    // A decoder that claims support but hangs (WebKitGTK's Vorbis) never progresses: give up
    // after DECODE_STALL_MS without progress and fall back (see below).
    let lastProgress = performance.now();
    let stalled = false;
    let release = () => {};
    const stall = new Promise<void>((resolve) => (release = resolve));
    conversion.onProgress = (progress) => {
      lastProgress = performance.now();
      if (cb.cancelled()) void conversion.cancel();
      else options.onFraction(progress);
    };
    const watchdog = setInterval(() => {
      if (cb.cancelled()) {
        void conversion.cancel().catch(() => {});
        release(); // Don't wait on a hung execute() either.
      } else if (performance.now() - lastProgress > DECODE_STALL_MS) {
        stalled = true;
        void conversion.cancel().catch(() => {});
        // `execute()` may never settle while the decoder hangs: stop waiting for it. The page
        // terminates this Worker after the job, which disposes of the abandoned conversion.
        release();
      }
    }, 250);
    const execution = conversion.execute();
    execution.catch(() => {});
    try {
      await Promise.race([execution, stall]);
    } catch (error) {
      if (cb.cancelled()) throw new CancelledError();
      if (!stalled) throw error instanceof ConversionCanceledError ? new CancelledError() : error;
    } finally {
      clearInterval(watchdog);
    }
    if (cb.cancelled()) throw new CancelledError();
    if (stalled) {
      const audio = await input.getPrimaryAudioTrack();
      // Audio: the page decodes it instead. Video: assume the audio hung and re-encode silent.
      if (target.kind === "audio" && audio) throw new UndecodableAudioError(source.name, audio.codec, audio.sampleRate, audio.numberOfChannels);
      if (target.kind === "video" && audio && !silent) return convert(source, target, options, true);
      throw new Error(`${source.name} could not be decoded by this browser.`);
    }
    return new Uint8Array(output.target.buffer!);
  } finally {
    input.dispose();
  }
}

/** First video stream re-encoded (never copied), optional audio in the container's codec. */
async function videoOptions(input: Input, name: string, format: VideoFormat, cb: JobCallbacks, silent: boolean): Promise<TrackOptions> {
  const spec = VIDEO_TARGETS[format];
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error(`${name} contains no usable video.`);
  const width = video.displayWidth - (video.displayWidth % 2);
  const height = video.displayHeight - (video.displayHeight % 2);
  const fps = (await video.computePacketStats(100).catch(() => null))?.averagePacketRate || 30;
  const bitrate = videoBitrate([width, height], Math.min(fps, 120), spec.quality);
  const supported = outputFormat(format).getSupportedVideoCodecs();
  const codec = await getFirstEncodableVideoCodec(
    spec.codecs.filter((c) => supported.includes(c)),
    { width, height, bitrate },
  );
  if (!codec) throw new Error(`This browser can't encode ${width} × ${height} video for ${format.toUpperCase()}.`);
  if (codec !== spec.codecs[0]) {
    cb.warn(`This browser can't encode ${CODEC_NAMES[spec.codecs[0]!]} here, so the video uses ${CODEC_NAMES[codec] ?? codec} in ${format.toUpperCase()}.`);
  }
  const odd = width !== video.displayWidth || height !== video.displayHeight;
  const audio = await input.getPrimaryAudioTrack();
  const audioOk = !!audio && !silent && (await audio.canDecode());
  if (audioOk) await ensureEncoder(spec.audio.codec);
  else if (audio) cb.warn(`${name} has audio this browser can't decode, so the output is silent.`);
  return {
    video: { codec, bitrate, forceTranscode: true, ...(odd ? { width, height, fit: "fill" as const } : {}) },
    audio: audioOk ? { ...spec.audio, sampleRate: encodeRate(spec.audio.codec, audio!.sampleRate), forceTranscode: true } : { discard: true },
  };
}

/** Audio re-encoded with the desktop's settings; video streams are dropped. */
async function audioOptions(input: Input, name: string, target: Extract<Target, { kind: "audio" }>): Promise<TrackOptions> {
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error(`${name} contains no usable audio.`);
  if (!(await track.canDecode())) throw new UndecodableAudioError(name, track.codec, track.sampleRate, track.numberOfChannels);
  const audio: ConversionAudioOptions = { forceTranscode: true, ...audioEncoding(target) };
  audio.sampleRate = encodeRate(audio.codec!, track.sampleRate);
  if (target.format === "flac" && track.codec === "flac") {
    // FFmpeg keeps a 16-bit FLAC 16-bit; the encoder picks 16 vs 24 from the sample format.
    const config = await track.getDecoderConfig().catch(() => null);
    if (parseStreamInfo(config?.description)?.bitsPerSample === 16) audio.sampleFormat = "s16";
  }
  await ensureEncoder(audio.codec!);
  return { video: { discard: true }, audio };
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

// ------------------------------------------------------------------ PCM route

/** Planar float PCM in order, as `[channels, frames]` spans of the (trimmed) range. */
type PcmSource = { sampleRate: number; channels: number; frames: number; spans: AsyncIterable<Float32Array[]> };

/** The trimmed range in frames, or StartPastEndError. */
function frameRange(total: number, rate: number, trim?: { start: number; duration: number }): [number, number] {
  if (!trim) return [0, total];
  const from = Math.round(trim.start * rate);
  if (from >= total) throw new StartPastEndError();
  return [from, Math.min(total, Math.round((trim.start + trim.duration) * rate))];
}

const SPAN_SECONDS = 1;

async function pcmSource(source: File, options: TranscodeOptions): Promise<PcmSource> {
  const { pcm, trim } = options;
  if (pcm) {
    const total = pcm.channels[0]?.length ?? 0;
    const [from, to] = frameRange(total, pcm.sampleRate, trim);
    const step = Math.round(pcm.sampleRate * SPAN_SECONDS);
    return {
      sampleRate: pcm.sampleRate,
      channels: pcm.channels.length,
      frames: to - from,
      spans: (async function* () {
        for (let at = from; at < to; at += step) yield pcm.channels.map((c) => c.subarray(at, Math.min(to, at + step)));
      })(),
    };
  }
  if (await isAiffSource(source)) {
    let layout;
    try {
      layout = await readAiffLayout(blobReader(source), source.size);
    } catch (error) {
      throw new Error(`${source.name} could not be read.`, { cause: error });
    }
    const rate = layout.sampleRate;
    const [from, to] = frameRange(layout.frames, rate, trim);
    const step = Math.round(rate * SPAN_SECONDS * 10);
    return {
      sampleRate: rate,
      channels: layout.channels,
      frames: to - from,
      spans: (async function* () {
        for (let at = from; at < to; at += step) {
          const end = Math.min(to, at + step);
          yield (await decodeAiffBlob(source, { start: at / rate, duration: (end - at) / rate })).channels;
        }
      })(),
    };
  }
  return mediabunnyPcm(source, trim);
}

/** Decoded audio of a Mediabunny-readable file, for targets Mediabunny can't write (AIFF). */
async function mediabunnyPcm(source: File, trim?: { start: number; duration: number }): Promise<PcmSource> {
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  let track;
  try {
    track = await input.getPrimaryAudioTrack();
  } catch (error) {
    input.dispose();
    throw new Error(`${source.name} could not be read.`, { cause: error });
  }
  if (!track) {
    input.dispose();
    throw new Error(`${source.name} contains no usable audio.`);
  }
  const rate = track.sampleRate;
  const undecodable = new UndecodableAudioError(source.name, track.codec, rate, track.numberOfChannels);
  if (!(await track.canDecode())) {
    input.dispose();
    throw undecodable;
  }
  const duration = await input.computeDuration();
  const [from, to] = frameRange(Math.round(duration * rate), rate, trim);
  const sink = new AudioSampleSink(track);
  return {
    sampleRate: rate,
    channels: track.numberOfChannels,
    frames: to - from,
    spans: (async function* () {
      const samples = sink.samples(from / rate, to / rate);
      try {
        for (;;) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const next = await Promise.race([samples.next(), new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), DECODE_STALL_MS)))]);
          clearTimeout(timer);
          if (!next) throw undecodable;
          if (next.done) return;
          const sample = next.value;
          // Clip the sample to [from, to) on the absolute frame axis.
          const start = Math.round(sample.timestamp * rate);
          const skip = Math.max(0, from - start);
          const keep = Math.min(sample.numberOfFrames, to - start) - skip;
          if (keep > 0) {
            yield Array.from({ length: sample.numberOfChannels }, (_, c) => {
              const plane = new Float32Array(sample.numberOfFrames);
              sample.copyTo(plane, { planeIndex: c, format: "f32-planar" });
              return plane.subarray(skip, skip + keep);
            });
          }
          sample.close();
        }
      } finally {
        void samples.return(undefined).catch(() => {});
        input.dispose();
      }
    })(),
  };
}

/** Encode a PCM source: AIFF in TS, everything else through a Mediabunny encoder + muxer. */
async function pcmPipeline(pcm: PcmSource, target: Extract<Target, { kind: "audio" }>, options: TranscodeOptions): Promise<Uint8Array> {
  const { cb, onFraction } = options;
  let done = 0;
  const step = (planes: Float32Array[]) => {
    if (cb.cancelled()) throw new CancelledError();
    done += planes[0]?.length ?? 0;
    onFraction(pcm.frames ? done / pcm.frames : 1);
  };
  if (target.format === "aiff") {
    // Collect 24-bit spans, then write once the frame count is known.
    const channels: Float32Array[][] = Array.from({ length: pcm.channels }, () => []);
    for await (const planes of pcm.spans) {
      planes.forEach((plane, c) => channels[c]!.push(plane.slice()));
      step(planes);
    }
    const joined = channels.map((parts) => {
      const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const part of parts) {
        out.set(part, at);
        at += part.length;
      }
      return out;
    });
    return encodeAiff24({ sampleRate: pcm.sampleRate, channels: joined });
  }
  const encoding = audioEncoding(target);
  await ensureEncoder(encoding.codec);
  const output = new Output({ format: outputFormat(target.format), target: new BufferTarget() });
  const source = new AudioSampleSource(encoding);
  output.addAudioTrack(source);
  await output.start();
  const rate = encodeRate(encoding.codec, pcm.sampleRate);
  const resampler = rate !== pcm.sampleRate ? new StreamResampler(pcm.channels, pcm.sampleRate, rate) : null;
  let at = 0;
  const add = async (planes: Float32Array[]) => {
    const n = planes[0]?.length ?? 0;
    if (!n) return;
    const data = new Float32Array(n * planes.length);
    planes.forEach((plane, c) => data.set(plane, c * n));
    const sample = new AudioSample({ data, format: "f32-planar", numberOfChannels: planes.length, sampleRate: rate, timestamp: at / rate });
    await source.add(sample);
    sample.close();
    at += n;
  };
  try {
    for await (const planes of pcm.spans) {
      await add(resampler ? resampler.push(planes) : planes);
      step(planes);
    }
    if (resampler) await add(resampler.finish());
    source.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  }
  return new Uint8Array(output.target.buffer!);
}
