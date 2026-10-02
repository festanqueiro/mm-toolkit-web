import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { decodeAiff } from "../src/engine/media/aiff";
import { historyRecords, mockFolderPicker, opfsFile, opfsNames, probe } from "./helpers";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));
const media = (name: string) => fileURLToPath(new URL(`../fixtures/media/${name}`, import.meta.url));

async function open(page: Page, browserName: string) {
  if (browserName === "chromium") await mockFolderPicker(page);
  await page.goto("/#/cutter");
}

async function chooseSource(page: Page, path: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: "Input" }).getByRole("button", { name: "Choose…" }).click();
  await (await chooser).setFiles(path);
}

async function chooseFolder(page: Page, browserName: string) {
  if (browserName !== "chromium") return;
  await page.getByRole("region", { name: /clip output$/ }).getByRole("button", { name: "Choose…" }).click();
  await expect(page.getByTestId("output-status")).toHaveText("✓ Export folder is writable.");
}

/** Run the job and return the single output's name and bytes (folder on Chromium, download elsewhere). */
async function createOne(page: Page, browserName: string, button: string): Promise<{ name: string; bytes: Uint8Array }> {
  if (browserName === "chromium") {
    await page.getByRole("button", { name: button }).click();
    await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 clip", { timeout: 60_000 });
    const [name] = await opfsNames(page);
    return { name: name!, bytes: Buffer.from(await opfsFile(page, name!), "base64") };
  }
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: button }).click();
  const file = await download;
  await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 clip");
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test("lists what's missing, validates rows and names the output format", async ({ page, browserName }) => {
  await open(page, browserName);
  await expect(page.getByRole("button", { name: "Create Media Clips" })).toBeDisabled();
  await expect(page.getByTestId("clip-status")).toHaveText("✓ 1 clip ready.");
  await expect(page.getByTestId("editing")).toHaveCount(0);
  const missing = browserName === "chromium" ? "choose valid source media; choose a writable export folder" : "choose valid source media";
  await expect(page.getByTestId("requirements")).toHaveText(`To enable Create Clips: ${missing}.`);

  await chooseSource(page, golden("audio/short-10s-mono.wav"));
  await expect(page.getByTestId("source-status")).toHaveText("✓ Source audio ready.");
  await expect(page.getByTestId("format-status")).toHaveText("✓ Audio clips will be exported as WAV files.");
  await expect(page.getByRole("region", { name: "Audio clip output" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Audio Clips" })).toBeVisible();
  if (browserName !== "chromium") await expect(page.getByTestId("output-status")).toHaveText("Clips are saved to your browser's Downloads folder.");

  await page.getByLabel("Start for clip 1").fill("");
  await expect(page.getByTestId("clip-status")).toHaveText("Clip 1: enter a start timestamp.");
  await page.getByLabel("Start for clip 1").fill("00:00:05");
  await page.getByLabel("End for clip 1").fill("4");
  await expect(page.getByTestId("clip-status")).toHaveText("Clip 1: End must be later than start.");
  await page.getByLabel("End for clip 1").fill("");
  await page.getByLabel("Duration for clip 1").fill("0");
  await expect(page.getByTestId("clip-status")).toHaveText("Clip 1: Duration must be greater than zero.");
  await page.getByLabel("Duration for clip 1").fill("");
  await expect(page.getByTestId("clip-status")).toHaveText("✓ 1 clip ready.");

  await page.getByRole("button", { name: "Add clip" }).click();
  await expect(page.getByTestId("clip-status")).toHaveText("✓ 2 clips ready.");
  await expect(page.getByLabel("Title for clip 2")).toHaveAttribute("placeholder", "Clip 02");
  await expect(page.getByTestId("editing")).toHaveText("Editing: Clip 02");
  await page.getByLabel("Title for clip 1").fill("Intro");
  await expect(page.getByTestId("editing")).toHaveText("Editing: Intro");
  await page.getByRole("button", { name: "Remove clip 2" }).click();
  await page.getByRole("button", { name: "Remove clip 1" }).click();
  // Removing the last row leaves a fresh empty one.
  await expect(page.getByLabel("Title for clip 1")).toHaveValue("");
  await expect(page.getByLabel("Start for clip 1")).toHaveValue("00:00:00");

  await chooseSource(page, media("visual-320x240.png"));
  await expect(page.getByTestId("source-status")).toHaveText("The selected file is not supported audio or video.");
});

test("Set Start / Set End write the player position into the current row", async ({ page, browserName }) => {
  await open(page, browserName);
  await chooseSource(page, golden("audio/short-10s-mono.wav"));
  await expect(page.getByTestId("player-time")).toHaveText("00:00:00 / 00:00:10");
  await page.getByRole("button", { name: "Add clip" }).click();
  const timeline = page.getByLabel("Timeline");
  await timeline.fill("3");
  await expect(page.getByTestId("player-time")).toHaveText("00:00:03 / 00:00:10");
  await page.getByRole("button", { name: "Set Start" }).click();
  await timeline.fill("7.6");
  await page.getByRole("button", { name: "Set End" }).click();
  await expect(page.getByLabel("Start for clip 2")).toHaveValue("00:00:03");
  await expect(page.getByLabel("End for clip 2")).toHaveValue("00:00:08");
  await expect(page.getByLabel("Start for clip 1")).toHaveValue("00:00:00");
});

test("cuts a WAV clip as sample-accurate 24-bit PCM", async ({ page, browserName }) => {
  await open(page, browserName);
  await chooseSource(page, golden("audio/short-10s-mono.wav"));
  await page.getByLabel("Start for clip 1").fill("1");
  await page.getByLabel("End for clip 1").fill("00:00:03.5");
  await page.getByLabel("Title for clip 1").fill("Hook");
  await chooseFolder(page, browserName);
  await expect(page.getByTestId("requirements")).toHaveText("✓ Ready to create clips.");
  const { name, bytes } = await createOne(page, browserName, "Create Audio Clips");
  expect(name).toBe("short-10s-mono - Hook.wav");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint16(34, true)).toBe(24); // fmt bitsPerSample
  const info = await probe(bytes);
  expect(info.audio?.channels).toBe(1);
  expect(info.duration).toBeCloseTo(2.5, 3);
});

for (const [file, ext, codec] of [
  ["tone-4s.mp3", "mp3", "mp3"],
  ["tone-4s.flac", "flac", "flac"],
  ["tone-4s.m4a", "m4a", "aac"],
  ["tone-4s.ogg", "ogg", "opus"],
] as const) {
  test(`keeps the source format: ${ext}`, async ({ page, browserName }) => {
    // Engines that hang decoding (WebKitGTK Vorbis) take the 15 s stall watchdog + Web Audio path.
    test.setTimeout(90_000);
    await open(page, browserName);
    await chooseSource(page, media(file));
    await expect(page.getByTestId("format-status")).toHaveText(`✓ Audio clips will be exported as ${ext.toUpperCase()} files.`);
    await page.getByLabel("Start for clip 1").fill("1");
    await page.getByLabel("Duration for clip 1").fill("2");
    await chooseFolder(page, browserName);
    const { name, bytes } = await createOne(page, browserName, "Create Audio Clips");
    expect(name).toBe(`tone-4s - Clip 01.${ext}`);
    const info = await probe(bytes);
    expect(info.audio?.codec).toBe(codec);
    expect(info.audio?.channels).toBe(2);
    expect(info.duration).toBeGreaterThan(1.95);
    expect(info.duration).toBeLessThan(2.1);
  });
}

test("keeps the source format: aiff (24-bit, written in TS)", async ({ page, browserName }) => {
  await open(page, browserName);
  await chooseSource(page, media("short-10s-mono.aiff"));
  await expect(page.getByTestId("format-status")).toHaveText("✓ Audio clips will be exported as AIFF files.");
  await page.getByLabel("Start for clip 1").fill("2");
  await page.getByLabel("Duration for clip 1").fill("1.5");
  await chooseFolder(page, browserName);
  const { name, bytes } = await createOne(page, browserName, "Create Audio Clips");
  expect(name).toBe("short-10s-mono - Clip 01.aiff");
  const pcm = decodeAiff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  expect(pcm.channels[0]!.length).toBe(Math.round(1.5 * pcm.sampleRate));
});

test("cuts a video clip to MP4 with its native size and audio", async ({ page, browserName }) => {
  await open(page, browserName);
  await chooseSource(page, media("clip-3s-320x240.mp4"));
  await expect(page.getByTestId("source-status")).toHaveText("✓ Source video ready.");
  await expect(page.getByTestId("format-status")).toHaveText("✓ Video clips will be exported as MP4 files.");
  await expect(page.getByRole("button", { name: "Create Video Clips" })).toBeVisible();
  await page.getByLabel("Start for clip 1").fill("0.5");
  await page.getByLabel("End for clip 1").fill("2");
  await chooseFolder(page, browserName);
  const { name, bytes } = await createOne(page, browserName, "Create Video Clips");
  expect(name).toBe("clip-3s-320x240 - Clip 01.mp4");
  const info = await probe(bytes);
  expect([info.width, info.height]).toEqual([320, 240]);
  expect(info.duration).toBeGreaterThan(1.45);
  expect(info.duration).toBeLessThan(1.6);
  expect(info.audio?.codec).toBe("aac");
});

test("a finished job is recorded in History and Clear resets the form", async ({ page, browserName }) => {
  await open(page, browserName);
  await chooseSource(page, golden("audio/short-10s-mono.wav"));
  await page.getByLabel("Title for clip 1").fill("Intro");
  await page.getByLabel("Start for clip 1").fill("2");
  await page.getByLabel("Duration for clip 1").fill("1");
  await chooseFolder(page, browserName);
  await createOne(page, browserName, "Create Audio Clips");
  const records = await historyRecords(page);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ tool: "clips", source: { name: "short-10s-mono.wav" }, clips: [{ title: "Intro", start: 2, duration: 1 }] });

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("source-status")).toHaveCount(0);
  await expect(page.getByLabel("Title for clip 1")).toHaveValue("");
  await expect(page.getByTestId("progress-status")).toHaveCount(0);
});
