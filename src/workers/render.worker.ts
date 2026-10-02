/// <reference lib="webworker" />
/** Runs one Video Creator job off the UI thread (spec 04 "Render pipeline"). */
import { CancelledError, renderPromoJob } from "../engine/render/promo";
import { createStagingSink, DirectorySink, MemorySink, type OutputSink } from "../io/sink";
import type { RenderEvent, RenderRequest } from "./render-protocol";

let cancelRequested = false;
const post = (event: RenderEvent) => self.postMessage(event);

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelRequested = true;
    return;
  }
  cancelRequested = false;
  try {
    const sink: OutputSink =
      request.destination.kind === "directory"
        ? new DirectorySink(request.destination.handle)
        : await createStagingSink(request.destination.jobId).catch(() => new MemorySink());
    const outputs = await renderPromoJob(request.job, sink, {
      progress: (percent, status) => post({ type: "progress", percent, status }),
      warn: (message) => post({ type: "warn", message }),
      cancelled: () => cancelRequested,
    });
    post({ type: "done", outputs });
  } catch (error) {
    if (error instanceof CancelledError) post({ type: "cancelled" });
    else {
      const err = error instanceof Error ? error : new Error(String(error));
      post({ type: "failed", message: err.message, details: err.stack ?? "" });
    }
  }
};
