/**
 * PWA runtime (spec 09): service worker registration, the "new version" prompt, the install
 * prompt and File Handling launches. Production builds only register the worker.
 */
import { launchTarget } from "../engine/launch";
import { converter } from "./tabs/converter/state.svelte";
import { cutter } from "./tabs/cutter/state.svelte";

export const pwa = $state({ updateReady: false, canInstall: false });

/** Minimal shapes so the update logic can be unit-tested with fakes. */
export type WorkerLike = EventTarget & { state: string; postMessage: (message: unknown) => void };
export type RegistrationLike = EventTarget & { waiting: WorkerLike | null; installing: WorkerLike | null };

/**
 * Call `onWaiting` when a new version has installed and waits to take over. A worker that
 * installs while no page is controlled is the first install, not an update.
 */
export function trackUpdates(registration: RegistrationLike, controlled: () => boolean, onWaiting: (worker: WorkerLike) => void): void {
  if (registration.waiting && controlled()) onWaiting(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && controlled()) onWaiting(worker);
    });
  });
}

let waiting: WorkerLike | null = null;

export async function registerPwa(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL;
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  } catch {
    return; // e.g. private browsing in some engines: the app still works online.
  }
  trackUpdates(
    registration as unknown as RegistrationLike,
    () => !!navigator.serviceWorker.controller,
    (worker) => {
      waiting = worker;
      pwa.updateReady = true;
    },
  );
  // Look for a new version hourly and whenever the app comes back to the foreground.
  const check = () => void registration.update().catch(() => {});
  setInterval(check, 60 * 60 * 1000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
}

/** "Reload": let the waiting version take over, then reload into it. */
export function applyUpdate(): void {
  if (!waiting) return location.reload();
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  waiting.postMessage({ type: "SKIP_WAITING" });
}

// ---- Install (Chromium's beforeinstallprompt) ----

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallPrompt | null = null;

export function listenForInstall(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPrompt;
    pwa.canInstall = true;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    pwa.canInstall = false;
  });
}

export async function install(): Promise<void> {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice.catch(() => null);
  deferred = null;
  pwa.canInstall = false;
}

// ---- File Handling ("Open with MM Toolkit", installed Chromium) ----

type LaunchParams = { files: { getFile: () => Promise<File> }[] };
type LaunchQueue = { setConsumer: (consumer: (params: LaunchParams) => void) => void };

export function listenForLaunches(): void {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer(async (params) => {
    const files = await Promise.all(params.files.map((handle) => handle.getFile().catch(() => null)));
    const named = files.filter((f): f is File => !!f);
    const target = launchTarget(named.map((f) => f.name));
    if (!target) return;
    const chosen = target.files.map((i) => named[i]!);
    if (target.route === "cutter") void cutter.setSource(chosen[0]!);
    else converter.add(chosen);
    location.hash = `#/${target.route}`;
  });
}
