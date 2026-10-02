/** Messages between the UI and `media.worker.ts` (decode + analysis off the main thread). */
import type { DecodeRange, PcmAudio } from "../engine/media/audio-decode";

export type MediaOps = {
  /** Decode (part of) a file to normalised stereo PCM. */
  decode: { args: { file: Blob; range?: DecodeRange }; result: PcmAudio };
  /** `detect_drop_time` on the whole track; seconds. */
  detectDrop: { args: { file: Blob }; result: number };
  /** Same, on PCM the main thread decoded (fallback for codecs the Worker can't decode). */
  detectDropPcm: { args: { pcm: PcmAudio }; result: number };
};

export type MediaOp = keyof MediaOps;

export type MediaRequest = { [K in MediaOp]: { id: number; op: K; args: MediaOps[K]["args"] } }[MediaOp];

export type MediaErrorKind = "unreadable" | "unsupported" | "empty" | "failed";

export type MediaResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string; kind: MediaErrorKind } };
