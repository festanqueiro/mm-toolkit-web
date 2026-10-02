/**
 * Clip cutting: port of `core.cut_media_clips` (spec 05). Runs in a Worker. Every clip is
 * re-encoded like the desktop (frame-accurate, never stream-copied): video → H.264 + AAC
 * MP4, audio → the source's own format. Clips run sequentially through `transcode`.
 */
import { clipOutputFormat, clipOutputName, type ClipFormat, type ClipRequest } from "../clips";
import type { PcmAudio } from "../media/aiff";
import { mediaKind } from "../media-kind";
import type { ConflictPolicy } from "../naming";
import type { OutputRef, OutputSink } from "../../io/sink";
import { CancelledError } from "./cancel";
import { StartPastEndError, transcode, type JobCallbacks, type Target } from "./transcode";

export { UndecodableAudioError } from "./transcode";

/**
 * `pcm`: the whole source decoded at its native rate by the page (Web Audio), for audio this
 * engine's Worker can't decode (see `UndecodableAudioError`).
 */
export type ClipJob = { source: File; clips: ClipRequest[]; naming: string; conflict: ConflictPolicy; pcm?: PcmAudio };

export type ClipCallbacks = JobCallbacks;

/** Desktop: AAC 256k in video clips (fixed by the MP4 target); 320k for MP3/AAC audio clips. */
const AUDIO_BITRATE = 320_000;
/** Ogg Vorbis q8 averages ~256 kbps; Opus stands in until ADR-003 decides. */
const OGG_OPUS_BITRATE = 256_000;

function clipTarget(format: ClipFormat): Target {
  if (format === "mp4") return { kind: "video", format: "mp4" };
  return { kind: "audio", format, bitrate: format === "ogg" ? OGG_OPUS_BITRATE : AUDIO_BITRATE };
}

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
      let bytes: Uint8Array;
      try {
        bytes = await transcode(job.source, clipTarget(format), {
          trim: clip,
          pcm: format === "mp4" ? undefined : job.pcm,
          cb,
          onFraction: (fraction) => cb.progress(Math.round(((index + Math.min(1, fraction)) / n) * 100), status),
        });
      } catch (error) {
        if (error instanceof StartPastEndError) throw new Error(`Clip ${index + 1} starts after the end of ${job.source.name}.`, { cause: error });
        throw error;
      }
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
