/** Messages between a tool and its job Worker (`render.worker.ts`, `job.worker.ts`). */
import type { ClipJob } from "../engine/render/clips";
import type { ConvertJob } from "../engine/render/convert";
import type { PromoJob } from "../engine/render/promo";
import type { OutputRef } from "../io/sink";

export type RenderDestination = { kind: "directory"; handle: FileSystemDirectoryHandle } | { kind: "staging"; jobId: string };

export type JobRequest<J> = { type: "start"; job: J; destination: RenderDestination } | { type: "cancel" };
export type RenderRequest = JobRequest<PromoJob>;
/** `job.worker.ts` runs either tool's job. */
export type ToolJob = { tool: "clips"; job: ClipJob } | { tool: "convert"; job: ConvertJob };
export type ToolRequest = JobRequest<ToolJob>;

/** The Worker can't decode a source's audio; the page decodes it and retries (resuming at `index`). */
export type Undecodable = { sampleRate: number; numberOfChannels: number; index?: number; outputs?: OutputRef[] };

export type RenderEvent =
  | { type: "progress"; percent: number; status: string }
  | { type: "warn"; message: string }
  | { type: "done"; outputs: OutputRef[] }
  | { type: "cancelled" }
  /** `undecodable`: the Worker can't decode the source's audio; the page may decode it (Web Audio) and retry. */
  | { type: "failed"; message: string; details: string; undecodable?: Undecodable };
