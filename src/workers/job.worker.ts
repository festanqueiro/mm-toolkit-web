/// <reference lib="webworker" />
/**
 * Runs one Media Cutter, Media Converter or Stem Splitter job off the UI thread (specs 05,
 * 06, 15).
 *
 * This entry module must not statically import anything: the bundler would put shared code
 * (Mediabunny, CancelledError, …) in it, lazily loaded chunks would import it back, and WebKit
 * evaluates an imported worker entry as a *second* instance — which re-registers `onmessage`
 * (so Cancel reaches the wrong copy) and duplicates Mediabunny (so registered WASM encoders
 * vanish). Everything lives in `job-host.ts`; `e2e/build.spec.ts` guards this.
 */
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
  const { runToolJob } = await import("./job-host");
  await runToolJob(request, post, () => cancelRequested);
};
