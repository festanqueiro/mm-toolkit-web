/** Messages between the Video Creator and `render.worker.ts`. */
import type { PromoJob } from "../engine/render/promo";
import type { OutputRef } from "../io/sink";

export type RenderDestination = { kind: "directory"; handle: FileSystemDirectoryHandle } | { kind: "staging"; jobId: string };

export type RenderRequest = { type: "start"; job: PromoJob; destination: RenderDestination } | { type: "cancel" };

export type RenderEvent =
  | { type: "progress"; percent: number; status: string }
  | { type: "warn"; message: string }
  | { type: "done"; outputs: OutputRef[] }
  | { type: "cancelled" }
  | { type: "failed"; message: string; details: string };
