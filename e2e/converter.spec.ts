import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { decodeAiff } from "../src/engine/media/aiff";
import { historyRecords, mockFolderPicker, opfsFile, opfsNames, probe } from "./helpers";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/audio/${name}`, import.meta.url));
const media = (name: string) => fileURLToPath(new URL(`../fixtures/media/${name}`, import.meta.url));

async function open(page: Page, browserName: string) {
  if (browserName === "chromium") await mockFolderPicker(page);
  await page.goto("/#/converter");
}

async function add(page: Page, ...paths: string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose Audio or Video Files…" }).click();
  await (await chooser).setFiles(paths);
}

async function chooseFolder(page: Page, browserName: string) {
  if (browserName !== "chromium") return;
  await page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" }).click();
  await expect(page.getByTestId("output-status")).toHaveText("✓ Export folder is writable.");
}

/** Run the job; returns each output's name and bytes (folder on Chromium; download or ZIP elsewhere). */
async function convertAll(page: Page, browserName: string, count: number): Promise<{ name: string; bytes: Uint8Array }[]> {
  const finished = `Finished ${count} conversion${count === 1 ? "" : "s"}`;
  if (browserName === "chromium") {
    await page.getByRole("button", { name: "Convert Files" }).click();
    await expect(page.getByTestId("progress-status")).toHaveText(finished, { timeout: 90_000 });
    const names = await opfsNames(page);
    return Promise.all(names.map(async (name) => ({ name, bytes: new Uint8Array(Buffer.from(await opfsFile(page, name), "base64")) })));
  }
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Convert Files" }).click();
  const file = await download;
  await expect(page.getByTestId("progress-status")).toHaveText(finished, { timeout: 90_000 });
  const bytes = new Uint8Array(readFileSync(await file.path()));
  if (count === 1) return [{ name: file.suggestedFilename(), bytes }];
  expect(file.suggestedFilename()).toMatch(/^Media Converter export .*\.zip$/);
  return Object.entries(unzipSync(bytes))
    .map(([name, data]) => ({ name, bytes: data }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

test("validates the batch, offers the right formats and keeps the choice", async ({ page, browserName }) => {
  await open(page, browserName);
  const missing = browserName === "chromium" ? "; choose a writable export folder" : "";
  await expect(page.getByTestId("requirements")).toHaveText(`To enable Convert: choose a valid audio-only or video-only batch${missing}.`);
  await expect(page.getByTestId("detected")).toHaveText("Not detected");

  await add(page, golden("short-10s-mono.wav"), media("clip-3s-320x240.mp4"));
  await expect(page.getByTestId("input-status")).toHaveText("Audio and video files cannot be mixed in one batch.");
  await page.getByRole("checkbox", { name: "clip-3s-320x240.mp4" }).check();
  await page.getByRole("button", { name: "Remove Selected" }).click();
  await expect(page.getByTestId("input-status")).toHaveText("✓ 1 audio file ready.");
  await expect(page.getByTestId("detected")).toHaveText("Audio");
  const formats = page.getByLabel("Convert to");
  await expect(formats.locator("option")).toHaveText(["MP3", "WAV", "AIFF", "FLAC", "M4A", "AAC", "OGG"]);
  await expect(formats).toHaveValue("mp3");
  await expect(page.getByLabel("MP3 bitrate")).toHaveValue("320k");
  await page.getByLabel("MP3 bitrate").selectOption("192k");
  await chooseFolder(page, browserName);
  await expect(page.getByTestId("requirements")).toHaveText("✓ Ready to convert 1 file to MP3 at 192 kbps.");

  await formats.selectOption("flac");
  await expect(page.getByLabel("MP3 bitrate")).toHaveCount(0);
  await add(page, media("tone-4s.ogg"));
  await expect(page.getByTestId("input-status")).toHaveText("✓ 2 audio files ready.");
  // Still audio: the FLAC choice is kept.
  await expect(formats).toHaveValue("flac");
  await expect(page.getByTestId("requirements")).toHaveText("✓ Ready to convert 2 files to FLAC.");

  await add(page, media("visual-320x240.png"));
  await expect(page.getByTestId("input-status")).toHaveText("One or more selected files cannot be used.");

  await page.getByRole("button", { name: "Clear" }).click();
  await add(page, media("clip-3s-320x240.mp4"));
  await expect(page.getByTestId("detected")).toHaveText("Video");
  await expect(formats.locator("option")).toHaveText(["MP4", "MOV", "MKV", "AVI (not available)", "WEBM"]);
  await expect(formats.locator("option", { hasText: "AVI" })).toBeDisabled();
  await expect(formats).toHaveValue("mp4");
});

for (const [format, codec] of [
  ["mp3", "mp3"],
  ["flac", "flac"],
  ["m4a", "aac"],
  ["aac", "aac"],
  ["ogg", "opus"],
  ["wav", "pcm-s24"],
] as const) {
  test(`audio → ${format}`, async ({ page, browserName }) => {
    test.setTimeout(120_000);
    await open(page, browserName);
    await add(page, golden("short-10s-mono.wav"));
    await page.getByLabel("Convert to").selectOption(format);
    await chooseFolder(page, browserName);
    const [out] = await convertAll(page, browserName, 1);
    expect(out!.name).toBe(`short-10s-mono.${format}`);
    const info = await probe(out!.bytes);
    expect(info.audio?.codec).toBe(codec);
    expect(info.duration).toBeGreaterThan(9.9);
    // AAC frames are 1024 samples: at this 11.025 kHz source, padding adds up to ~0.2 s.
    expect(info.duration).toBeLessThan(format === "m4a" || format === "aac" ? 10.3 : 10.2);
  });
}

test("audio → aiff (24-bit, written in TS)", async ({ page, browserName }) => {
  await open(page, browserName);
  await add(page, media("tone-4s.flac"));
  await page.getByLabel("Convert to").selectOption("aiff");
  await chooseFolder(page, browserName);
  const [out] = await convertAll(page, browserName, 1);
  expect(out!.name).toBe("tone-4s.aiff");
  const pcm = decodeAiff(out!.bytes.buffer.slice(out!.bytes.byteOffset, out!.bytes.byteOffset + out!.bytes.byteLength) as ArrayBuffer);
  expect(pcm.channels).toHaveLength(2);
  expect(pcm.channels[0]!.length).toBe(4 * pcm.sampleRate);
});

for (const [source, format, codecs] of [
  ["clip-3s-320x240.mp4", "mov", ["avc"]],
  ["clip-3s-320x240.mp4", "mkv", ["avc"]],
  ["clip-3s-320x240.mp4", "webm", ["vp9", "av1", "vp8"]],
  ["clip-3s-320x240.mkv", "mp4", ["avc"]],
] as const) {
  test(`video ${source.split(".").pop()} → ${format}`, async ({ page, browserName }) => {
    test.setTimeout(120_000);
    await open(page, browserName);
    await add(page, media(source));
    await page.getByLabel("Convert to").selectOption(format);
    await chooseFolder(page, browserName);
    const [out] = await convertAll(page, browserName, 1);
    expect(out!.name).toBe(`clip-3s-320x240.${format}`);
    const info = await probe(out!.bytes);
    expect([info.width, info.height]).toEqual([320, 240]);
    expect(codecs as readonly string[]).toContain(info.videoCodec);
    expect(info.audio?.codec).toBe(format === "webm" ? "opus" : "aac");
    expect(info.duration).toBeGreaterThan(2.9);
    expect(info.duration).toBeLessThan(3.2);
  });
}

test("a batch converts every file and is recorded in History", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await open(page, browserName);
  await add(page, golden("short-10s-mono.wav"), media("tone-4s.m4a"));
  await page.getByLabel("Convert to").selectOption("wav");
  await chooseFolder(page, browserName);
  const outputs = await convertAll(page, browserName, 2);
  expect(outputs.map((o) => o.name)).toEqual(["short-10s-mono.wav", "tone-4s.wav"]);
  const records = await historyRecords(page);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ tool: "converter", format: "wav", bitrate: "320k", source: { name: "short-10s-mono.wav" } });
  expect((records[0]!.sources as unknown[]).length).toBe(2);
});
