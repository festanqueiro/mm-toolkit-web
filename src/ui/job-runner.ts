/** Shared plumbing for tools that run a job in a Worker (main thread only). */
import type { OutputRef } from "../io/sink";
import type { JobRequest, RenderEvent } from "../workers/render-protocol";
import { app } from "./state.svelte";

/** `cancelled`: Cancel was pressed before this worker existed; it's forwarded as soon as the job starts. */
export type JobHandlers = { progress: (percent: number, status: string) => void; warn: (message: string) => void; cancelled?: () => boolean };

type WakeLock = { release: () => Promise<void> };

/**
 * Start `request` on `worker` (created by the caller so Vite can bundle it). Resolves with
 * the outputs, or null when cancelled; rejects on failure with `details` (the stack). Holds
 * a screen wake lock while running. The caller terminates the worker.
 */
export function runJob<J>(worker: Worker, request: JobRequest<J>, on: JobHandlers): Promise<OutputRef[] | null> {
  const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLock> } };
  let lock: WakeLock | null = null;
  let finished = false;
  nav.wakeLock?.request("screen").then(
    (l) => (finished ? void l.release().catch(() => {}) : (lock = l)),
    () => {},
  );
  const done = () => {
    finished = true;
    void lock?.release().catch(() => {});
  };
  return new Promise<OutputRef[] | null>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<RenderEvent>) => {
      const e = event.data;
      if (e.type === "progress") on.progress(e.percent, e.status);
      else if (e.type === "warn") on.warn(e.message);
      else if (e.type === "done") resolve(e.outputs);
      else if (e.type === "cancelled") resolve(null);
      else reject(Object.assign(new Error(e.message), { details: e.details, undecodable: e.undecodable }));
    };
    worker.onerror = (event) => reject(new Error(event.message || "The worker stopped unexpectedly."));
    worker.postMessage(request);
    if (on.cancelled?.()) worker.postMessage({ type: "cancel" } satisfies JobRequest<J>);
  }).finally(done);
}

/** Desktop completion signal: "{title} finished" / "Created {n} file{s}." (spec 07). */
export function notifyFinished(title: string, count: number): void {
  if (!app.settings["general/notify_finished"] || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(`${title} finished`, { body: count ? `Created ${count} file${count === 1 ? "" : "s"}.` : "Finished.", icon: "favicon.png" });
    n.onclick = () => window.focus();
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

/** References only: in-memory outputs' bytes don't belong in History. */
export const historyOutputs = (outputs: OutputRef[]) => outputs.map((ref) => ({ name: ref.name, sink: ref.sink, size: ref.size, opfsPath: ref.opfsPath }));
