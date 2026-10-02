/** Messages between a tool and its job Worker (`render.worker.ts`, `cut.worker.ts`). */
import type { ClipJob } from "../engine/render/clips";
import type { PromoJob } from "../engine/render/promo";
import type { OutputRef } from "../io/sink";

export type RenderDestination = { kind: "directory"; handle: FileSystemDirectoryHandle } | { kind: "staging"; jobId: string };

export type JobRequest<J> = { type: "start"; job: J; destination: RenderDestination } | { type: "cancel" };
export type RenderRequest = JobRequest<PromoJob>;
export type CutRequest = JobRequest<ClipJob>;

export type RenderEvent =
  | { type: "progress"; percent: number; status: string }
  | { type: "warn"; message: string }
  | { type: "done"; outputs: OutputRef[] }
  | { type: "cancelled" }
  | { type: "failed"; message: string; details: string };
