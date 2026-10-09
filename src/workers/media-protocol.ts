/** Messages between the UI and `media.worker.ts` (decode + analysis off the main thread). */
import type { DecodeRange, PcmAudio } from "../engine/media/audio-decode";

export type MediaOps = {
  /** Decode (part of) a file to normalised stereo PCM. */
  decode: { args: { file: Blob; range?: DecodeRange }; result: PcmAudio };
  /**
   * Bass envelope of the snippet `[range.start, range.start + range.duration)` at `fps`
   * (`_build_bass_envelope`), plus the snippet's actual duration (clamped to the track end).
   */
  bassEnvelope: { args: { file: Blob; range: DecodeRange; fps: number }; result: { envelope: Float64Array; duration: number } };
  /** Waveform: min/max of the mono mix in `columns` columns (interleaved), plus the duration in seconds. */
  peaks: { args: { file: Blob; columns: number }; result: { peaks: Float32Array; duration: number } };
};

export type MediaOp = keyof MediaOps;

export type MediaRequest = { [K in MediaOp]: { id: number; op: K; args: MediaOps[K]["args"] } }[MediaOp];

export type MediaErrorKind = "unreadable" | "unsupported" | "empty" | "failed";

/** `progress` (0–1) may come any number of times before the answer; only `peaks` reports it. */
export type MediaResponse =
  | { id: number; progress: number }
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string; kind: MediaErrorKind } };
