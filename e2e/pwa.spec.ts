import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { serveDist } from "./helpers";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));

test("works offline after the first load, including a clip job", async ({ page, browserName }) => {
  test.slow();
  const server = await serveDist();
  try {
    await page.goto(`${server.origin}/`);
    const hasWorkers = await page.evaluate(() => "serviceWorker" in navigator);
    test.skip(!hasWorkers, "No service workers in this browser context.");
    // The first install claims the page once everything is precached.
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
    expect(await page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith("mm-toolkit-")))).toBe(true);

    await server.stop(); // The network is gone from here on.
    await page.reload();
    await expect(page.getByRole("link", { name: "MM Toolkit home" })).toBeVisible();

    // A whole job offline: shell, job Worker, transcoder and codecs all come from the cache.
    await page.evaluate(() => (location.hash = "#/cutter"));
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("region", { name: "Source" }).getByRole("button", { name: "Choose…" }).click();
    await (await chooser).setFiles(golden("audio/short-10s-mono.wav"));
    await expect(page.getByTestId("source-status")).toHaveText("✓ Source audio ready.");
    await page.getByLabel("Duration for clip 1").fill("1");
    if (browserName === "chromium") {
      await page.evaluate(() => {
        (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
          (await navigator.storage.getDirectory()).getDirectoryHandle("exports-test", { create: true });
      });
      await page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" }).click();
    }
    const download = browserName === "chromium" ? null : page.waitForEvent("download");
    await page.getByRole("button", { name: "Create Audio Clips" }).click();
    await download;
    await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 clip", { timeout: 60_000 });
  } finally {
    await server.stop().catch(() => {});
  }
});

test("files opened with the app go to the Cutter (one) or the Converter (several)", async ({ page }) => {
  // Chromium's launchQueue only exists for installed apps; stand in for it.
  // Chromium defines a read-only `launchQueue` even when not installed: replace it.
  await page.addInitScript(() => {
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: {
        setConsumer(consumer: unknown) {
          (window as unknown as { __launch: unknown }).__launch = consumer;
        },
      },
    });
  });
  await page.goto("/#/about");
  const wav = readFileSync(golden("audio/short-10s-mono.wav")).toString("base64");
  const launch = (names: string[]) =>
    page.evaluate(
      ({ names, wav }) => {
        const bytes = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0));
        const files = names.map((name) => ({ getFile: async () => new File([bytes], name) }));
        (window as unknown as { __launch: (p: unknown) => void }).__launch({ files });
      },
      { names, wav },
    );

  await launch(["mix.wav"]);
  await expect(page).toHaveURL(/#\/cutter$/);
  await expect(page.getByTestId("source-status")).toHaveText("✓ Source audio ready.");

  await launch(["a.wav", "notes.txt", "b.wav"]);
  await expect(page).toHaveURL(/#\/converter$/);
  await expect(page.getByTestId("input-status")).toHaveText("✓ 2 audio files ready.");
});
