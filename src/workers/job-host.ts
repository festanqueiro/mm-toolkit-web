/** The job Worker's logic, loaded lazily by `job.worker.ts` (see there for why). */
import { CancelledError } from "../engine/render/cancel";
import { NeedsPageDecodeError } from "../engine/render/convert";
import { UndecodableAudioError } from "../engine/render/transcode";
import { createStagingSink, DirectorySink, MemorySink, type OutputSink } from "../io/sink";
import type { RenderEvent, ToolRequest } from "./render-protocol";

export async function runToolJob(request: Extract<ToolRequest, { type: "start" }>, post: (event: RenderEvent) => void, cancelled: () => boolean): Promise<void> {
  try {
    const sink: OutputSink =
      request.destination.kind === "directory"
        ? new DirectorySink(request.destination.handle)
        : await createStagingSink(request.destination.jobId).catch(() => new MemorySink());
    const callbacks = {
      progress: (percent: number, status: string) => post({ type: "progress", percent, status }),
      warn: (message: string) => post({ type: "warn", message }),
      cancelled,
    };
    const outputs =
      request.job.tool === "clips"
        ? await (await import("../engine/render/clips")).cutClipsJob(request.job.job, sink, callbacks)
        : request.job.tool === "convert"
          ? await (await import("../engine/render/convert")).convertJob(request.job.job, sink, callbacks)
          : await (await import("../engine/render/stems")).splitStemsJob(request.job.job, sink, callbacks);
    post({ type: "done", outputs });
  } catch (error) {
    if (error instanceof CancelledError) post({ type: "cancelled" });
    else {
      const err = error instanceof Error ? error : new Error(String(error));
      const undecodable =
        error instanceof UndecodableAudioError
          ? {
              sampleRate: error.sampleRate,
              numberOfChannels: error.numberOfChannels,
              ...(error instanceof NeedsPageDecodeError ? { index: error.index, outputs: error.outputs } : {}),
            }
          : undefined;
      post({ type: "failed", message: err.message, details: err.stack ?? "", undecodable });
    }
  }
}
