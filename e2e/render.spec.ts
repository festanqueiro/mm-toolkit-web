import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));
const media = (name: string) => fileURLToPath(new URL(`../fixtures/media/${name}`, import.meta.url));

/** Chromium exports into a folder: back the picker with an OPFS directory the test can read. */
async function mockFolderPicker(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle("exports-test", { create: true });
  });
}

async function setUp(page: Page, browserName: string, duration = "2") {
  if (browserName === "chromium") await mockFolderPicker(page);
  await page.goto("/#/video-creator");
  const input = page.getByRole("region", { name: "Input" });
  let chooser = page.waitForEvent("filechooser");
  await input.getByRole("button", { name: "Choose File…" }).click();
  await (await chooser).setFiles(golden("audio/drop-30s-stereo.wav"));
  chooser = page.waitForEvent("filechooser");
  await input.getByRole("button", { name: "Choose…", exact: true }).click();
  await (await chooser).setFiles(media("visual-320x240.png"));
  await expect(page.getByTestId("visual-status")).toHaveText("✓ Image ready.");
  await page.getByRole("button", { name: "Audio timestamps" }).click();
  await page.getByLabel("Start for track 1").fill("27");
  await page.getByLabel("Duration for track 1 in seconds").fill(duration);
  await page.getByLabel("Duration for track 1 in seconds").blur();
  if (browserName === "chromium") {
    await page.getByRole("region", { name: "Output" }).getByRole("button", { name: "Choose…" }).click();
    await expect(page.getByTestId("output-status")).toHaveText("✓ Export folder is writable.");
  }
  await expect(page.getByTestId("requirements")).toHaveText("✓ Ready to generate videos.");
}

/** Bytes of an exported file in the mocked OPFS folder (Chromium). */
const opfsFile = (page: Page, name: string) =>
  page.evaluate(async (name) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("exports-test");
    const file = await (await dir.getFileHandle(name)).getFile();
    let binary = "";
    for (const byte of new Uint8Array(await file.arrayBuffer())) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, name);

const opfsNames = (page: Page) =>
  page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("exports-test", { create: true });
    const names: string[] = [];
    for await (const key of (dir as unknown as { keys: () => AsyncIterable<string> }).keys()) names.push(key);
    return names.sort();
  });

async function probe(bytes: Uint8Array) {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  return {
    duration: await input.computeDuration(),
    width: video?.displayWidth,
    height: video?.displayHeight,
    audio: audio ? { channels: audio.numberOfChannels, sampleRate: audio.sampleRate } : null,
  };
}

test("renders a promo MP4 with the snippet's duration, the visual's size and stereo audio", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await setUp(page, browserName);
  let bytes: Uint8Array;
  if (browserName === "chromium") {
    await page.getByRole("button", { name: "Generate Video" }).click();
    await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 video", { timeout: 90_000 });
    expect(await opfsNames(page)).toEqual(["drop-30s-stereo - Promo Snippet.mp4"]);
    bytes = Buffer.from(await opfsFile(page, "drop-30s-stereo - Promo Snippet.mp4"), "base64");
  } else {
    const download = page.waitForEvent("download", { timeout: 90_000 });
    await page.getByRole("button", { name: "Generate Video" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("drop-30s-stereo - Promo Snippet.mp4");
    bytes = readFileSync(await file.path());
    await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 video");
  }
  const info = await probe(bytes);
  expect(info.width).toBe(320);
  expect(info.height).toBe(240);
  expect(info.duration).toBeGreaterThan(1.9);
  expect(info.duration).toBeLessThan(2.15);
  expect(info.audio?.channels).toBe(2);
  expect([44_100, 48_000]).toContain(info.audio?.sampleRate);
});

test("a second render with the same name gets a numbered copy (Chromium folder export)", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Conflict policies apply to folder exports (Tier 1).");
  test.setTimeout(120_000);
  await setUp(page, browserName, "1");
  for (let run = 0; run < 2; run++) {
    await page.getByRole("button", { name: "Generate Video" }).click();
    await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 video", { timeout: 90_000 });
  }
  expect(await opfsNames(page)).toEqual(["drop-30s-stereo - Promo Snippet (2).mp4", "drop-30s-stereo - Promo Snippet.mp4"]);
});

test("cancel stops the job and leaves no partial file", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await setUp(page, browserName, "60");
  await page.getByLabel("Start for track 1").fill("0");
  await page.getByLabel("Video profile").selectOption({ label: "Landscape 1920 × 1080" });
  await page.getByRole("button", { name: "Generate Video" }).click();
  await expect(page.getByTestId("progress-status")).toHaveText(/Rendering drop-30s-stereo\.wav/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("progress-status")).toHaveText("Cancelled. Partial files were removed.", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  if (browserName === "chromium") expect(await opfsNames(page)).toEqual([]);
});

test("a finished job is recorded in History", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await setUp(page, browserName, "1");
  const download = browserName === "chromium" ? null : page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Generate Video" }).click();
  await download;
  await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 video", { timeout: 90_000 });
  const records = await page.evaluate(
    () =>
      new Promise<Array<Record<string, unknown>>>((resolve) => {
        const open = indexedDB.open("mm-toolkit");
        open.onsuccess = () => {
          const get = open.result.transaction("history").objectStore("history").getAll();
          get.onsuccess = () => resolve(get.result as Array<Record<string, unknown>>);
        };
      }),
  );
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ tool: "promo", fps: 24, profile: null, tracks: [{ start: 27, duration: 1 }] });
});

test("a video visual loops its frames and can mix in its own sound", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  if (browserName === "chromium") await mockFolderPicker(page);
  await page.goto("/#/video-creator");
  const input = page.getByRole("region", { name: "Input" });
  let chooser = page.waitForEvent("filechooser");
  await input.getByRole("button", { name: "Choose File…" }).click();
  await (await chooser).setFiles(golden("audio/short-10s-mono.wav"));
  chooser = page.waitForEvent("filechooser");
  await input.getByRole("button", { name: "Choose…", exact: true }).click();
  await (await chooser).setFiles(media("clip-320x240.webm"));
  await expect(page.getByTestId("visual-status")).toHaveText("✓ Video ready.");
  await page.getByRole("button", { name: "Audio timestamps" }).click();
  // 2.5 s of output from a 1 s clip: the visual loops.
  await page.getByLabel("Duration for track 1 in seconds").fill("2.5");
  await page.getByLabel("Duration for track 1 in seconds").blur();
  await page.getByRole("button", { name: "Post-Effects" }).click();
  await page.getByLabel("Mute original video sound").uncheck();
  await page.getByRole("button", { name: "Output" }).click();
  if (browserName === "chromium") await page.getByRole("region", { name: "Output" }).getByRole("button", { name: "Choose…" }).click();
  const download = browserName === "chromium" ? null : page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Generate Video" }).click();
  await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 video", { timeout: 90_000 });
  const bytes =
    browserName === "chromium"
      ? Buffer.from(await opfsFile(page, "short-10s-mono - Promo Snippet.mp4"), "base64")
      : readFileSync(await (await download)!.path());
  const info = await probe(bytes);
  expect([info.width, info.height]).toEqual([320, 240]);
  expect(info.duration).toBeGreaterThan(2.4);
  expect(info.duration).toBeLessThan(2.65);
  expect(info.audio?.channels).toBe(2);
});
