import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { historyRecords, mockFolderPicker, waitForStored } from "./helpers";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));
const media = (name: string) => fileURLToPath(new URL(`../fixtures/media/${name}`, import.meta.url));

async function pick(page: Page, button: string, ...paths: string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: button, exact: true }).first().click();
  await (await chooser).setFiles(paths);
}

/** A two-clip Cutter job on short-10s-mono.wav; returns once it finished. */
async function cutTwoClips(page: Page, browserName: string) {
  await page.goto("/#/cutter");
  await pick(page, "Choose…", golden("audio/short-10s-mono.wav"));
  await expect(page.getByTestId("source-status")).toHaveText("✓ Source audio ready.");
  await page.getByLabel("Title for clip 1").fill("Intro");
  await page.getByLabel("Start for clip 1").fill("1");
  await page.getByLabel("Duration for clip 1").fill("1");
  await page.getByRole("button", { name: "Add clip" }).click();
  await page.getByLabel("Title for clip 2").fill("Outro");
  await page.getByLabel("Start for clip 2").fill("00:00:08");
  await page.getByLabel("End for clip 2").fill("9");
  if (browserName === "chromium") await page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" }).click();
  const download = browserName === "chromium" ? null : page.waitForEvent("download");
  await page.getByRole("button", { name: "Create Audio Clips" }).click();
  await download;
  await expect(page.getByTestId("progress-status")).toHaveText("Finished 2 clips", { timeout: 60_000 });
}

test("a finished job raises the History badge; the progress link opens it with the job selected", async ({ page, browserName }) => {
  if (browserName === "chromium") await mockFolderPicker(page);
  await cutTwoClips(page, browserName);
  const tab = page.getByRole("navigation", { name: "Tools" }).getByRole("link", { name: /History/ });
  await expect(tab).toHaveText("History (1)");

  await page.getByTestId("progress-status").getByRole("button").click();
  await expect(page).toHaveURL(/#\/history$/);
  await expect(tab).toHaveText("History");
  const job = page.getByRole("option", { selected: true });
  await expect(job).toContainText("•  Media Cutter  •  short-10s-mono.wav");

  if (browserName === "chromium") {
    // Folder exports resolve through the persisted handle.
    const files = page.getByRole("list", { name: "Rendered files" });
    await expect(files.getByRole("button")).toHaveText(["short-10s-mono - Intro.wav", "short-10s-mono - Outro.wav"]);
    await files.getByRole("button", { name: "short-10s-mono - Intro.wav" }).click();
    await expect(page.locator(".preview audio")).toBeVisible();
  } else {
    // Downloads are read lazily from a staged copy, which stays until the next job or app
    // load. Where OPFS is unavailable (Playwright's ephemeral WebKit) outputs are in memory only.
    const [record] = await historyRecords(page);
    const staged = (record!.outputs as { sink: string }[]).every((o) => o.sink === "staged");
    const files = page.getByRole("list", { name: "Rendered files" });
    if (staged) await expect(files.getByRole("button")).toHaveText(["short-10s-mono - Intro.wav", "short-10s-mono - Outro.wav"]);
    else await expect(page.getByTestId("history-status")).toHaveText("No rendered files found for this job.");
    // Copies aren't kept by default: after a reload they're gone.
    await page.reload();
    await expect(page.getByTestId("history-status")).toHaveText("No rendered files found for this job.");
  }
});

test("with copies kept, Tier 2 outputs stay previewable and downloadable, even after a reload", async ({ page, browserName }) => {
  test.skip(browserName === "chromium", "Chromium exports into a folder (covered above).");
  await page.goto("/#/settings");
  const opfs = await page.evaluate(() => navigator.storage.getDirectory().then(() => true, () => false));
  test.skip(!opfs, "This browser context has no OPFS (Playwright's ephemeral WebKit), so copies can't be kept.");
  await page.getByLabel("Keep copies of outputs for History previews (uses browser storage)").check();
  await waitForStored(page, "web/keep_output_copies", true);
  await cutTwoClips(page, browserName);
  await page.goto("/#/history");
  await page.reload();
  const files = page.getByRole("list", { name: "Rendered files" });
  await expect(files.getByRole("button")).toHaveText(["short-10s-mono - Intro.wav", "short-10s-mono - Outro.wav"]);
  await files.getByRole("button", { name: "short-10s-mono - Outro.wav" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("short-10s-mono - Outro.wav");

  await page.goto("/#/settings");
  await expect(page.getByTestId("kept-usage")).toHaveText(/^Using \d+(\.\d)? KB of 2\.0 GB\./);
});

test("Load Job restores the Cutter's clips and names the source to re-select", async ({ page, browserName }) => {
  if (browserName === "chromium") await mockFolderPicker(page);
  await cutTwoClips(page, browserName);
  await page.getByRole("button", { name: "Clear" }).click();
  await page.goto("/#/history");
  await page.getByRole("button", { name: "Load Job" }).click();
  await expect(page).toHaveURL(/#\/cutter$/);
  await expect(page.getByTestId("source-hint")).toHaveText("Re-select short-10s-mono.wav");
  await expect(page.getByLabel("Title for clip 1")).toHaveValue("Intro");
  await expect(page.getByLabel("Start for clip 1")).toHaveValue("00:00:01");
  await expect(page.getByLabel("Duration for clip 1")).toHaveValue("1.0");
  await expect(page.getByLabel("Title for clip 2")).toHaveValue("Outro");
  await expect(page.getByLabel("Start for clip 2")).toHaveValue("00:00:08");
  await expect(page.getByLabel("End for clip 2")).toHaveValue("");
  await expect(page.getByLabel("Duration for clip 2")).toHaveValue("1.0");
  if (browserName === "chromium") await expect(page.getByTestId("output-status")).toHaveText("✓ Export folder is writable.");
  await pick(page, "Choose…", golden("audio/short-10s-mono.wav"));
  await expect(page.getByTestId("source-status")).toHaveText("✓ Source audio ready.");
});

test("Load Job restores the Converter's format and the Video Creator's per-track timings", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  if (browserName === "chromium") await mockFolderPicker(page);
  // Converter: FLAC.
  await page.goto("/#/converter");
  await pick(page, "Choose Audio or Video Files…", golden("audio/short-10s-mono.wav"));
  await page.getByLabel("Convert to").selectOption("flac");
  if (browserName === "chromium") await page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" }).click();
  let download = browserName === "chromium" ? null : page.waitForEvent("download");
  await page.getByRole("button", { name: "Convert Files" }).click();
  await download;
  await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 conversion", { timeout: 60_000 });

  // Video Creator: one track starting at 27 s, 1 s long.
  await page.goto("/#/video-creator");
  await pick(page, "Choose File(s)…", golden("audio/drop-30s-stereo.wav"));
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: "Image or video" }).getByRole("button", { name: "Choose…", exact: true }).click();
  await (await chooser).setFiles(media("visual-320x240.png"));
  await expect(page.getByTestId("visual-status")).toHaveText("✓ Image ready.");
  await page.getByLabel("Start for track 1").fill("27");
  await page.getByLabel("Duration for track 1 in seconds").fill("1");
  await page.getByLabel("Duration for track 1 in seconds").blur();
  if (browserName === "chromium") await page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" }).click();
  download = browserName === "chromium" ? null : page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Generate Video" }).click();
  await download;
  await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 video", { timeout: 90_000 });

  // Newest first: the promo, then the conversion.
  await page.goto("/#/history");
  const jobs = page.getByRole("option");
  await expect(jobs).toHaveCount(2);
  await expect(jobs.nth(0)).toContainText("Video Creator  •  drop-30s-stereo.wav");
  await expect(jobs.nth(1)).toContainText("Media Converter  •  short-10s-mono.wav");

  await jobs.nth(1).getByRole("button").click();
  await page.getByRole("button", { name: "Load Job" }).click();
  await expect(page).toHaveURL(/#\/converter$/);
  await expect(page.getByTestId("files-hint")).toHaveText("Re-select short-10s-mono.wav");
  await pick(page, "Choose Audio or Video Files…", golden("audio/short-10s-mono.wav"));
  await expect(page.getByLabel("Convert to")).toHaveValue("flac");

  await page.goto("/#/history");
  await page.getByRole("option").nth(0).getByRole("button").click();
  await page.getByRole("button", { name: "Load Job" }).click();
  await expect(page).toHaveURL(/#\/video-creator$/);
  await expect(page.getByTestId("audio-hint")).toHaveText("Re-select drop-30s-stereo.wav");
  await expect(page.getByTestId("visual-hint")).toHaveText("Re-select visual-320x240.png");
  await pick(page, "Choose File(s)…", golden("audio/drop-30s-stereo.wav"));
  await expect(page.getByTestId("timestamps-status")).toHaveText("✓ Loaded saved per-track timings.");
  await expect(page.getByLabel("Start for track 1")).toHaveValue("00:00:27");
  await expect(page.getByLabel("Duration for track 1 in seconds")).toHaveValue("1");
});

test("Clear History removes every job", async ({ page, browserName }) => {
  if (browserName === "chromium") await mockFolderPicker(page);
  await cutTwoClips(page, browserName);
  await page.goto("/#/history");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear History" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear History" }).click();
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("Finished jobs appear here.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load Job" })).toBeDisabled();
});
