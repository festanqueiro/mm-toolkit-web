/// <reference lib="webworker" />
/** Runs one Media Cutter or Media Converter job off the UI thread (specs 05, 06). */
import { CancelledError } from "../engine/render/cancel";
import { createStagingSink, DirectorySink, MemorySink, type OutputSink } from "../io/sink";
import type { RenderEvent, ToolRequest } from "./render-protocol";

let cancelRequested = false;
const post = (event: RenderEvent) => self.postMessage(event);

self.onmessage = async (event: MessageEvent<ToolRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelRequested = true;
    return;
  }
  cancelRequested = false;
  // Pipelines load lazily so Mediabunny lands in a shared chunk rather than this entry module:
  // the WASM encoder chunks import it, and WebKit re-evaluates an imported worker entry as a
  // second instance, so encoders registered there would be invisible to the job.
  const { UndecodableAudioError } = await import("../engine/render/transcode");
  const { NeedsPageDecodeError } = await import("../engine/render/convert");
  try {
    const sink: OutputSink =
      request.destination.kind === "directory"
        ? new DirectorySink(request.destination.handle)
        : await createStagingSink(request.destination.jobId).catch(() => new MemorySink());
    const callbacks = {
      progress: (percent: number, status: string) => post({ type: "progress", percent, status }),
      warn: (message: string) => post({ type: "warn", message }),
      cancelled: () => cancelRequested,
    };
    const outputs =
      request.job.tool === "clips"
        ? await (await import("../engine/render/clips")).cutClipsJob(request.job.job, sink, callbacks)
        : await (await import("../engine/render/convert")).convertJob(request.job.job, sink, callbacks);
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
};
