/// <reference lib="webworker" />
/** Runs one Media Cutter job off the UI thread (spec 05). */
import { CancelledError } from "../engine/render/cancel";
import { createStagingSink, DirectorySink, MemorySink, type OutputSink } from "../io/sink";
import type { CutRequest, RenderEvent } from "./render-protocol";

let cancelRequested = false;
const post = (event: RenderEvent) => self.postMessage(event);

self.onmessage = async (event: MessageEvent<CutRequest>) => {
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
    // Loaded lazily so Mediabunny lands in a shared chunk rather than this entry module: the
    // WASM encoder chunks import it, and WebKit re-evaluates an imported worker entry as a
    // second instance, so encoders registered there would be invisible to the conversion.
    const { cutClipsJob } = await import("../engine/render/clips");
    const outputs = await cutClipsJob(request.job, sink, {
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
