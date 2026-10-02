import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));
const media = (name: string) => fileURLToPath(new URL(`../fixtures/media/${name}`, import.meta.url));

async function choose(page: Page, button: string | RegExp, files: string | string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: button, exact: true }).click();
  await (await chooser).setFiles(files);
}

async function openTimestamps(page: Page) {
  const header = page.getByRole("button", { name: "Audio timestamps" });
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
}

/** Chromium (Tier 1) exports into a chosen folder; WebKit/Firefox download, so no folder is needed. */
const folderMissing = (browserName: string) => (browserName === "chromium" ? "; choose a writable export folder" : "");

test.beforeEach(async ({ page }) => {
  await page.goto("/#/video-creator");
  await expect(page.getByRole("heading", { name: "Video Creator", level: 1 })).toBeVisible();
});

test("starts with every requirement listed", async ({ page, browserName }) => {
  await expect(page.getByTestId("requirements")).toHaveText(
    `To enable Generate: choose audio; choose a valid image or video${folderMissing(browserName)}.`,
  );
  await expect(page.getByRole("button", { name: "Generate Videos" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Audio timestamps" })).toBeDisabled();
});

test("audio file + image: statuses, track row and drop detection", async ({ page, browserName }) => {
  await choose(page, "Choose File…", golden("audio/drop-45s-mono.wav"));
  await expect(page.getByTestId("audio-status")).toHaveText("✓ Found 1 audio file.");
  await expect(page.getByRole("button", { name: "Generate Video" })).toBeVisible();

  await choose(page, "Choose…", golden("frames/input.png"));
  await expect(page.getByTestId("visual-status")).toHaveText("✓ Image ready.");
  await expect(page.getByAltText("Preview of input.png")).toBeVisible();
  const expected = browserName === "chromium" ? "To enable Generate: choose a writable export folder." : "✓ Ready to generate videos.";
  await expect(page.getByTestId("requirements")).toHaveText(expected);

  await openTimestamps(page);
  await expect(page.getByRole("cell", { name: "drop-45s-mono.wav", exact: true })).toBeVisible();
  await expect(page.getByTestId("timestamps-status")).toHaveText("Edit start times manually or use ✨ to detect a drop for one track.");
  await expect(page.getByTestId("duration-summary")).toHaveText("00:01:00 per video • 00:01:00 combined");
  await expect(page.getByTestId("job-summary")).toHaveText("1 output(s)");

  await page.getByRole("button", { name: "Detect drop for this track" }).click();
  const dialog = page.getByRole("dialog", { name: "Detect drop start" });
  await expect(dialog).toContainText("MM Toolkit will analyze drop-45s-mono.wav and propose a start time based on its main drop.");
  await expect(dialog.getByLabel("Start before the drop")).toHaveValue("2");
  await dialog.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByTestId("timestamps-status")).toHaveText("✓ Proposed 00:00:43 for drop-45s-mono.wav. You can edit or preview it.");
  await expect(page.getByLabel("Start for track 1")).toHaveValue("00:00:43");
});

test("lead-in is remembered and applied", async ({ page }) => {
  await choose(page, "Choose File…", golden("audio/drop-30s-stereo.wav"));
  await openTimestamps(page);
  await page.getByRole("button", { name: "Detect drop for this track" }).click();
  await page.getByLabel("Start before the drop").fill("5");
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByLabel("Start for track 1")).toHaveValue("00:00:25");

  await page.reload();
  await choose(page, "Choose File…", golden("audio/drop-30s-stereo.wav"));
  await openTimestamps(page);
  await page.getByRole("button", { name: "Detect drop for this track" }).click();
  await expect(page.getByLabel("Start before the drop")).toHaveValue("5");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("invalid start blocks Generate and preview", async ({ page }) => {
  await choose(page, "Choose File…", golden("audio/short-10s-mono.wav"));
  await openTimestamps(page);
  await page.getByLabel("Start for track 1").fill("1:75");
  await expect(page.getByTestId("requirements")).toContainText("Track 1: Invalid timestamp: 1:75");

  await page.getByRole("button", { name: "Play preview for short-10s-mono.wav" }).click();
  const alert = page.getByRole("dialog", { name: "Preview unavailable" });
  await expect(alert).toContainText("Invalid timestamp: 1:75");
  await alert.getByRole("button", { name: "OK" }).click();
  await expect(alert).toBeHidden();
});

test("preview plays the snippet and toggles off", async ({ page }) => {
  await choose(page, "Choose File…", golden("audio/short-10s-mono.wav"));
  await openTimestamps(page);
  await page.getByLabel("Start for track 1").fill("2");
  const play = page.getByRole("button", { name: "Play preview for short-10s-mono.wav" });
  await expect(play).toHaveAttribute("title", "Listen from 2 for 60 seconds");
  await play.click();
  await expect(page.getByTestId("timestamps-status")).toHaveText("Listening to short-10s-mono.wav from 00:00:02 for 60 seconds.");
  const stop = page.getByRole("button", { name: "Stop preview for short-10s-mono.wav" });
  await expect(stop).toHaveAttribute("aria-pressed", "true");
  await stop.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
});

test("folder selection keeps direct audio children in name order", async ({ page }) => {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose Folder…" }).click();
  await (await chooser).setFiles(golden("audio"));
  await expect(page.getByTestId("audio-status")).toHaveText("✓ Found 3 audio files.");
  await openTimestamps(page);
  await expect(page.locator("td.name")).toHaveText(["drop-30s-stereo.wav", "drop-45s-mono.wav", "short-10s-mono.wav"]);
  await expect(page.getByRole("button", { name: "Generate Videos" })).toBeVisible();
});

test("AIFF audio is accepted and analysed", async ({ page }) => {
  await choose(page, "Choose File…", media("short-10s-mono.aiff"));
  await openTimestamps(page);
  await page.getByRole("button", { name: "Detect drop for this track" }).click();
  await page.getByRole("button", { name: "Analyze" }).click();
  // Desktop short-track quirk: the 10 s fixture proposes 9.5 − 2.0 → 00:00:08 (banker's rounding of 7.5).
  await expect(page.getByLabel("Start for track 1")).toHaveValue("00:00:08");
});

test("visual validation messages", async ({ page }) => {
  await choose(page, "Choose…", media("broken.png"));
  await expect(page.getByTestId("visual-status")).toHaveText("The selected artwork could not be read.");
  for (const clip of ["clip-320x240.webm", "clip-64x48.mp4"]) {
    await choose(page, "Choose…", media(clip));
    await expect(page.getByTestId("visual-status")).toHaveText("✓ Video ready.");
    await expect(page.getByAltText(`Preview of ${clip}`)).toBeVisible();
  }
  await choose(page, "Choose…", golden("audio/short-10s-mono.wav"));
  await expect(page.getByTestId("visual-status")).toHaveText("The selected file cannot be used as an image or video.");
});
