/**
 * Batch conversion: port of `core.convert_media` (spec 06). Runs in a Worker; files convert
 * sequentially through `transcode`.
 */
import { convertOutputName, convertingFile, finishedConversions, MP3_BITRATES, UNAVAILABLE_FORMATS, type OutputFormatName } from "../converter";
import type { PcmAudio } from "../media/aiff";
import { AUDIO_OUTPUT_FORMATS, mediaKind, VIDEO_OUTPUT_FORMATS } from "../media-kind";
import type { ConflictPolicy } from "../naming";
import type { OutputRef, OutputSink } from "../../io/sink";
import { CancelledError } from "./cancel";
import { transcode, UndecodableAudioError, type JobCallbacks, type Target } from "./transcode";

/**
 * `from` + `pcm`: resume at `sources[from]` with that file decoded by the page (see
 * `NeedsPageDecodeError`). `bitrate` is the MP3 bitrate (`128k`…`320k`).
 */
export type ConvertJob = { sources: File[]; format: string; bitrate: string; conflict: ConflictPolicy; from?: number; pcm?: PcmAudio };

/** File `index` needs page decoding; `outputs` are the files already written before it. */
export class NeedsPageDecodeError extends UndecodableAudioError {
  constructor(
    cause: UndecodableAudioError,
    readonly index: number,
    readonly outputs: OutputRef[],
  ) {
    super("", null, cause.sampleRate, cause.numberOfChannels);
    this.message = cause.message;
  }
}

/** Desktop: AAC 256k for M4A/AAC; Vorbis q6 (~192 kbps) becomes Opus 192k until ADR-003. */
const AAC_BITRATE = 256_000;
const OGG_OPUS_BITRATE = 192_000;

function convertTarget(format: OutputFormatName, bitrate: string): Target {
  if ((VIDEO_OUTPUT_FORMATS as readonly string[]).includes(format)) return { kind: "video", format: format as Extract<Target, { kind: "video" }>["format"] };
  const lossy = format === "mp3" ? parseInt(bitrate, 10) * 1000 : format === "ogg" ? OGG_OPUS_BITRATE : AAC_BITRATE;
  return { kind: "audio", format: format as Extract<Target, { kind: "audio" }>["format"], bitrate: lossy };
}

export async function convertJob(job: ConvertJob, sink: OutputSink, cb: JobCallbacks): Promise<OutputRef[]> {
  const files = job.sources;
  if (!files.length) throw new Error("Choose at least one media file.");
  const kinds = new Set(files.map((f) => mediaKind(f.name)));
  if (kinds.has(null) || kinds.size !== 1) throw new Error("Choose either audio files or video files, not a mixed selection.");
  const kind = [...kinds][0]!;
  const allowed: readonly string[] = kind === "audio" ? AUDIO_OUTPUT_FORMATS : VIDEO_OUTPUT_FORMATS;
  const format = job.format.toLowerCase().replace(/^\./, "") as OutputFormatName;
  if (!allowed.includes(format)) throw new Error(`${format.toUpperCase()} is not a supported ${kind} output format.`);
  if (!(MP3_BITRATES as readonly string[]).includes(job.bitrate)) throw new Error("Audio bitrate must be 128k, 192k, 256k, or 320k.");
  const unavailable = UNAVAILABLE_FORMATS[format];
  if (unavailable) throw new Error(unavailable);

  const target = convertTarget(format, job.bitrate);
  const n = files.length;
  const outputs: OutputRef[] = [];
  for (let index = job.from ?? 0; index < n; index++) {
    const source = files[index]!;
    if (cb.cancelled()) throw new CancelledError();
    const name = await sink.resolveName(convertOutputName(source.name, format), job.conflict);
    if (name === null) continue; // "skip": an output with this name exists.
    const status = convertingFile(source.name, index, n);
    cb.progress(Math.round((index / n) * 100), status);
    try {
      const bytes = await transcode(source, target, {
        pcm: index === job.from ? job.pcm : undefined,
        cb,
        onFraction: (fraction) => cb.progress(Math.round(((index + Math.min(1, fraction)) / n) * 100), status),
      });
      const writer = (await sink.create(name)).getWriter();
      await writer.write(bytes);
      await writer.close();
      outputs.push(await sink.complete(name));
    } catch (error) {
      await sink.remove(name).catch(() => {});
      if (error instanceof UndecodableAudioError && kind === "audio") throw new NeedsPageDecodeError(error, index, outputs);
      throw error;
    }
  }
  cb.progress(100, finishedConversions(outputs.length));
  return outputs;
}
