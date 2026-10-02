import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { precacheList, serviceWorkerSource } from "../scripts/pwa";
import { launchTarget } from "../src/engine/launch";
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "../src/engine/media-kind";

describe("service worker build", () => {
  it("precaches the shell (even when index.html isn't listed yet) and assets, not the spike page, social image or itself", () => {
    expect(precacheList(["assets/main-1.js"])).toEqual(["./", "assets/main-1.js"]);
    expect(precacheList(["index.html", "assets/main-1.js", "spike.html", "assets/spike-2.js", "social-preview.png", "sw.js", "icon-192.png", "icon-192.png"])).toEqual([
      "./",
      "assets/main-1.js",
      "icon-192.png",
    ]);
  });

  it("injects the version (cache name) and the list", () => {
    const template = 'const VERSION = "__VERSION__";\nconst PRECACHE = __PRECACHE__;';
    expect(serviceWorkerSource(template, "1.2.3", ["index.html"])).toBe('const VERSION = "1.2.3";\nconst PRECACHE = ["./"];');
  });

  it("the template has both placeholders", () => {
    const template = readFileSync(new URL("../scripts/sw-template.js", import.meta.url), "utf8");
    expect(template).toContain('"__VERSION__"');
    expect(template).toContain("__PRECACHE__");
  });
});

describe("File Handling", () => {
  it("one file → Cutter, several → Converter, unsupported dropped", () => {
    expect(launchTarget(["mix.wav"])).toEqual({ route: "cutter", files: [0] });
    expect(launchTarget(["a.mp4", "notes.txt", "b.mov"])).toEqual({ route: "converter", files: [0, 2] });
    expect(launchTarget(["cover.png", "notes.txt"])).toBeNull();
    expect(launchTarget(["notes.txt", "clip.mkv"])).toEqual({ route: "cutter", files: [1] });
  });

  it("the manifest declares every input extension and existing icons", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
    const accepted = Object.values(manifest.file_handlers[0].accept as Record<string, string[]>).flat();
    expect(accepted.sort()).toEqual([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS].sort());
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) expect(existsSync(new URL(`../public/${icon.src}`, import.meta.url))).toBe(true);
    expect(manifest.launch_handler.client_mode).toBe("focus-existing");
  });
});

describe("update detection", () => {
  class FakeWorker extends EventTarget {
    state = "installing";
    messages: unknown[] = [];
    postMessage(m: unknown) {
      this.messages.push(m);
    }
    become(state: string) {
      this.state = state;
      this.dispatchEvent(new Event("statechange"));
    }
  }
  class FakeRegistration extends EventTarget {
    waiting: FakeWorker | null = null;
    installing: FakeWorker | null = null;
  }

  it("an installed worker waiting behind a controlled page is an update; a first install isn't", async () => {
    const { trackUpdates } = await import("../src/ui/pwa.svelte");
    for (const controlled of [true, false]) {
      const registration = new FakeRegistration();
      const seen: FakeWorker[] = [];
      trackUpdates(registration, () => controlled, (w) => seen.push(w as FakeWorker));
      const worker = new FakeWorker();
      registration.installing = worker;
      registration.dispatchEvent(new Event("updatefound"));
      worker.become("installed");
      expect(seen).toEqual(controlled ? [worker] : []);
    }
  });

  it("a version already waiting at load is reported", async () => {
    const { trackUpdates } = await import("../src/ui/pwa.svelte");
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker();
    const seen: unknown[] = [];
    trackUpdates(registration, () => true, (w) => seen.push(w));
    expect(seen).toEqual([registration.waiting]);
  });
});
