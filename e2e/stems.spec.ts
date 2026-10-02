import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { ALL_FORMATS, AudioSampleSink, BufferSource, Input } from "mediabunny";
import { decodeAiff } from "../src/engine/media/aiff";
import { historyRecords, mockFolderPicker, opfsFile, opfsNames } from "./helpers";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));
const fake = readFileSync(fileURLToPath(new URL("../fixtures/stems/fake-htdemucs.onnx", import.meta.url)));

/**
 * The 607-byte stand-in model (same I/O as HT-Demucs; stems = drums 0.4, bass 0.3, other 0.2,
 * vocals 0.1 of the mix), so CI never downloads the 170 MB model.
 */
async function useFakeModel(page: Page) {
  const graph = { url: `data:application/octet-stream;base64,${fake.toString("base64")}`, bytes: fake.length, sha256: "4d712ab18c9bba354a218d4c0e6c487a8b42aa5a14eb3920b67cc7ac07db7d14" };
  await page.addInitScript((graph) => {
    (window as unknown as { __MM_STEM_MODEL__: unknown }).__MM_STEM_MODEL__ = { graph, data: null };
  }, graph);
}

async function open(page: Page, browserName: string) {
  await useFakeModel(page);
  if (browserName === "chromium") await mockFolderPicker(page);
  await page.goto("/#/stems");
}

async function chooseSource(page: Page, path: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: "Source" }).getByRole("button", { name: "Choose…" }).click();
  await (await chooser).setFiles(path);
  await expect(page.getByTestId("source-status")).toHaveText("✓ Source ready.");
}

/** Run and return each stem file (folder on Chromium; downloads/ZIP elsewhere). */
async function split(page: Page, browserName: string, count: number): Promise<Map<string, Uint8Array>> {
  const finished = `Finished ${count} stem${count === 1 ? "" : "s"}`;
  if (browserName === "chromium") {
    await page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" }).click();
    await page.getByRole("button", { name: "Split Stems" }).click();
    await expect(page.getByTestId("progress-status")).toHaveText(finished, { timeout: 120_000 });
    const names = await opfsNames(page);
    return new Map(await Promise.all(names.map(async (n) => [n, new Uint8Array(Buffer.from(await opfsFile(page, n), "base64"))] as const)));
  }
  const downloads: Promise<import("@playwright/test").Download>[] = [];
  const done = new Promise<void>((resolve) => {
    page.on("download", (d) => {
      downloads.push(Promise.resolve(d));
      if (downloads.length === (count > 1 ? 1 : 1)) resolve();
    });
  });
  await page.getByRole("button", { name: "Split Stems" }).click();
  await done;
  await expect(page.getByTestId("progress-status")).toHaveText(finished, { timeout: 120_000 });
  const download = await downloads[0]!;
  const bytes = new Uint8Array(readFileSync(await download.path()));
  if (count === 1) return new Map([[download.suggestedFilename(), bytes]]);
  const { unzipSync } = await import("fflate");
  return new Map(Object.entries(unzipSync(bytes)));
}

async function rms(bytes: Uint8Array) {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const track = (await input.getPrimaryAudioTrack())!;
  let sum = 0;
  let n = 0;
  for await (const sample of new AudioSampleSink(track).samples()) {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex: 0, format: "f32-planar" });
    for (const v of plane) sum += v * v;
    n += plane.length;
    sample.close();
  }
  return { rms: Math.sqrt(sum / n), duration: await input.computeDuration(), rate: track.sampleRate, channels: track.numberOfChannels };
}

test("lists what's missing and the default stems", async ({ page, browserName }) => {
  await open(page, browserName);
  await expect(page.getByTestId("stems-status")).toHaveText("✓ 2 stems selected.");
  await expect(page.getByRole("checkbox", { name: "Vocals" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^Instrumental/ })).toBeChecked();
  await expect(page.getByTestId("model-status")).toHaveText("Model: HT-Demucs (170 MB, downloaded once)");
  const folder = browserName === "chromium" ? "; choose a writable export folder" : "";
  await expect(page.getByTestId("requirements")).toHaveText(`To enable Split Stems: choose a source${folder}.`);
  await page.getByRole("checkbox", { name: "Vocals" }).uncheck();
  await page.getByRole("checkbox", { name: /^Instrumental/ }).uncheck();
  await expect(page.getByTestId("stems-status")).toHaveText("Choose at least one stem.");
});

test("splits vocals and instrumental: 44.1 kHz stereo, full length, the right stems mixed", async ({ page, browserName }) => {
  test.setTimeout(180_000);
  await open(page, browserName);
  await chooseSource(page, golden("audio/short-10s-mono.wav"));
  const files = await split(page, browserName, 2);
  expect([...files.keys()].sort()).toEqual(["short-10s-mono - Instrumental.wav", "short-10s-mono - Vocals.wav"]);
  const vocals = await rms(files.get("short-10s-mono - Vocals.wav")!);
  const instrumental = await rms(files.get("short-10s-mono - Instrumental.wav")!);
  expect([vocals.rate, vocals.channels]).toEqual([44_100, 2]);
  expect(vocals.duration).toBeCloseTo(10, 1);
  // Stand-in model: vocals = 0.1 of the mix, instrumental = drums + bass + other = 0.9.
  expect(instrumental.rms / vocals.rms).toBeGreaterThan(8.5);
  expect(instrumental.rms / vocals.rms).toBeLessThan(9.5);
  const results = page.getByRole("complementary", { name: "Output" }).getByRole("list", { name: "Results" });
  await expect(results.locator("audio")).toHaveCount(2);
  await expect(results.getByRole("button", { name: "Download" })).toHaveCount(2);
  const [record] = await historyRecords(page);
  expect(record).toMatchObject({ tool: "stems", stems: ["vocals", "instrumental"], format: "wav" });
});

test("all four stems, as AIFF, keep their relative levels", async ({ page, browserName }) => {
  test.setTimeout(180_000);
  await open(page, browserName);
  await chooseSource(page, golden("audio/drop-30s-stereo.wav"));
  for (const stem of ["Drums", "Bass", "Other"]) await page.getByRole("checkbox", { name: stem, exact: true }).check();
  await page.getByRole("checkbox", { name: /^Instrumental/ }).uncheck();
  await page.getByLabel("Output format").selectOption("mp3");
  await expect(page.getByLabel("MP3 bitrate")).toBeVisible();
  await page.getByLabel("Output format").selectOption("aiff");
  await expect(page.getByLabel("MP3 bitrate")).toHaveCount(0);
  const files = await split(page, browserName, 4);
  expect([...files.keys()].sort()).toEqual(["Bass", "Drums", "Other", "Vocals"].map((s) => `drop-30s-stereo - ${s}.aiff`));
  const level = (stem: string) => {
    const bytes = files.get(`drop-30s-stereo - ${stem}.aiff`)!;
    const pcm = decodeAiff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(pcm.sampleRate).toBe(44_100);
    let sum = 0;
    for (const v of pcm.channels[0]!) sum += v * v;
    return Math.sqrt(sum / pcm.channels[0]!.length);
  };
  const [drums, bass, other, vocals] = ["Drums", "Bass", "Other", "Vocals"].map(level);
  // Stand-in model: 0.4 : 0.3 : 0.2 : 0.1 of the mix, through the whole pipeline.
  expect(drums! / vocals!).toBeCloseTo(4, 2);
  expect(bass! / vocals!).toBeCloseTo(3, 2);
  expect(other! / vocals!).toBeCloseTo(2, 2);
});

test("cancel leaves no files, and the same worker runs the next job", async ({ page, browserName }) => {
  // Cancel right away: the stand-in model is so fast on WebGPU that a mid-separation click
  // could land after the last segment. Cancelling between segments is covered by the
  // `separate()` unit tests.
  test.setTimeout(120_000);
  await open(page, browserName);
  await chooseSource(page, golden("audio/drop-30s-stereo.wav"));
  if (browserName === "chromium") await page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" }).click();
  await page.getByRole("button", { name: "Split Stems" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("progress-status")).toHaveText("Cancelled. Partial files were removed.", { timeout: 60_000 });
  if (browserName === "chromium") expect(await opfsNames(page)).toEqual([]);
  // The same worker runs the next job.
  await page.getByRole("button", { name: "Split Stems" }).click();
  await expect(page.getByTestId("progress-status")).toHaveText("Finished 2 stems", { timeout: 120_000 });
});

test("Load Job restores the stems, format and names the source", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await open(page, browserName);
  await chooseSource(page, golden("audio/short-10s-mono.wav"));
  await page.getByRole("checkbox", { name: "Drums", exact: true }).check();
  await page.getByLabel("Output format").selectOption("flac");
  await split(page, browserName, 3);
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByLabel("Output format")).toHaveValue("wav");
  await page.goto("/#/history");
  await expect(page.getByRole("option").first()).toContainText("Stem Splitter  •  short-10s-mono.wav");
  await page.getByRole("button", { name: "Load Job" }).click();
  await expect(page).toHaveURL(/#\/stems$/);
  await expect(page.getByTestId("source-hint")).toHaveText("Re-select short-10s-mono.wav");
  await expect(page.getByLabel("Output format")).toHaveValue("flac");
  for (const [stem, on] of [["Vocals", true], ["Drums", true], ["Bass", false], ["Other", false]] as const) {
    await expect(page.getByRole("checkbox", { name: stem, exact: true })).toBeChecked({ checked: on });
  }
});
