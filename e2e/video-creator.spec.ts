import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { waitForStored } from "./helpers";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));
const media = (name: string) => fileURLToPath(new URL(`../fixtures/media/${name}`, import.meta.url));

/** Click a picker button in the Audio or Image or video section and answer the file chooser. */
async function choose(page: Page, button: string, files: string | string[]) {
  const chooser = page.waitForEvent("filechooser");
  const region = /File/.test(button) ? "Audio" : "Image or video";
  await page.getByRole("region", { name: region }).getByRole("button", { name: button, exact: true }).click();
  await (await chooser).setFiles(files);
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
});

test("the image or video is chosen first, then the audio", async ({ page }) => {
  const top = async (name: string) => (await page.getByRole("region", { name, exact: true }).boundingBox())!.y;
  expect(await top("Image or video")).toBeLessThan(await top("Audio"));
});

test("each drop zone is named by its section without repeating the heading on screen", async ({ page }) => {
  for (const name of ["Audio", "Image or video"]) {
    const section = page.getByRole("region", { name });
    await expect(section.getByRole("group", { name })).toBeVisible();
    const titles = await section.getByText(name, { exact: true }).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height > 1));
    expect(titles.filter(Boolean)).toHaveLength(1);
  }
});

test("audio file + image: statuses, track row and drop detection", async ({ page, browserName }) => {
  await choose(page, "Choose File(s)…", golden("audio/drop-45s-mono.wav"));
  await expect(page.getByTestId("audio-status")).toHaveText("✓ Found 1 audio file.");
  await expect(page.getByRole("button", { name: "Generate Video" })).toBeVisible();

  await choose(page, "Choose…", golden("frames/input.png"));
  await expect(page.getByTestId("visual-status")).toHaveText("✓ Image ready.");
  await expect(page.getByAltText("Preview of input.png")).toBeVisible();
  const expected = browserName === "chromium" ? "To enable Generate: choose a writable export folder." : "✓ Ready to generate videos.";
  await expect(page.getByTestId("requirements")).toHaveText(expected);

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
  await choose(page, "Choose File(s)…", golden("audio/drop-30s-stereo.wav"));
  await page.getByRole("button", { name: "Detect drop for this track" }).click();
  await page.getByLabel("Start before the drop").fill("5");
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByLabel("Start for track 1")).toHaveValue("00:00:25");

  await waitForStored(page, "promo/drop_lead_in", 5);
  await page.reload();
  await choose(page, "Choose File(s)…", golden("audio/drop-30s-stereo.wav"));
  await page.getByRole("button", { name: "Detect drop for this track" }).click();
  await expect(page.getByLabel("Start before the drop")).toHaveValue("5");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("invalid start blocks Generate and preview", async ({ page }) => {
  await choose(page, "Choose File(s)…", golden("audio/short-10s-mono.wav"));
  await page.getByLabel("Start for track 1").fill("1:75");
  await expect(page.getByTestId("requirements")).toContainText("Track 1: Invalid timestamp: 1:75");

  await page.getByRole("button", { name: "Play preview for short-10s-mono.wav" }).click();
  const alert = page.getByRole("dialog", { name: "Preview unavailable" });
  await expect(alert).toContainText("Invalid timestamp: 1:75");
  await alert.getByRole("button", { name: "OK" }).click();
  await expect(alert).toBeHidden();
});

test("preview plays the snippet and toggles off", async ({ page }) => {
  await choose(page, "Choose File(s)…", golden("audio/short-10s-mono.wav"));
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

test("several files can be chosen at once, listed in name order", async ({ page }) => {
  await choose(page, "Choose File(s)…", [golden("audio/short-10s-mono.wav"), golden("audio/drop-30s-stereo.wav")]);
  await expect(page.getByTestId("audio-status")).toHaveText("✓ Found 2 audio files.");
  await expect(page.locator(".zone-file")).toHaveText("2 files");
  await expect(page.locator("td.name")).toHaveText(["drop-30s-stereo.wav", "short-10s-mono.wav"]);
  await expect(page.getByRole("button", { name: "Choose Folder…" })).toHaveCount(0);
});

test("AIFF audio is accepted and analysed", async ({ page }) => {
  await choose(page, "Choose File(s)…", media("short-10s-mono.aiff"));
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

async function ready(page: Page, audio = "audio/drop-45s-mono.wav") {
  await choose(page, "Choose File(s)…", golden(audio));
  await choose(page, "Choose…", golden("frames/input.png"));
  await expect(page.getByTestId("visual-status")).toHaveText("✓ Image ready.");
}

/** Pixels of the live-preview canvas, read back through a 2D canvas. */
const previewPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".live-preview-canvas")!;
    const ctx = Object.assign(document.createElement("canvas"), { width: canvas.width, height: canvas.height }).getContext("2d")!;
    ctx.drawImage(canvas, 0, 0);
    return { width: canvas.width, height: canvas.height, sum: ctx.getImageData(0, 0, canvas.width, canvas.height).data.reduce((a, b) => a + b, 0) };
  });

test("effects, layers and post-effects stay disabled until audio and visual are valid", async ({ page }) => {
  await expect(page.getByLabel("Glitch", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Fade video in/out")).toBeDisabled();
  await ready(page);
  await expect(page.getByLabel("Glitch", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Fade video in/out")).toBeEnabled();
  await expect(page.getByText("Mute original video sound")).toHaveCount(0);
});

test("effects list: defaults, enable/disable controls, keyboard reorder", async ({ page }) => {
  await ready(page);
  await expect(page.getByText("Drag rows to change the order effects are applied in.")).toBeVisible();
  const order = page.locator("ol.effects > li");
  await expect(order).toHaveText([/Overlay/, /Bass-reactive Blur/, /Rotate/, /VHS/, /Glitch/]);
  await expect(page.getByLabel("Bass-reactive Blur", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Rotate speed in RPM")).toBeDisabled();
  await page.getByLabel("Rotate", { exact: true }).check();
  await expect(page.getByLabel("Rotate speed in RPM")).toBeEnabled();
  await expect(page.getByLabel("Rotate speed in RPM")).toHaveValue("33.3");

  await page.getByRole("button", { name: "Reorder Glitch (arrow keys)" }).focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(order).toHaveText([/Overlay/, /Bass-reactive Blur/, /Glitch/, /Rotate/, /VHS/]);
  await expect(page.getByRole("button", { name: "Reorder Glitch (arrow keys)" })).toBeFocused();
});

test("layers: solid colour swatch and image background", async ({ page }) => {
  await ready(page);
  await expect(page.locator(".hex", { hasText: "#19191d" })).toBeVisible();
  await page.getByLabel("Fill").selectOption("image");
  await expect(page.locator(".hex", { hasText: "#19191d" })).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#background-image-label + .field").getByRole("button", { name: "Choose…" }).click();
  await (await chooser).setFiles(golden("frames/background.png"));
  await expect(page.getByTestId("background-status")).toHaveText("✓ 64 × 48");
  const overlayChooser = page.waitForEvent("filechooser");
  await page.locator("#overlay-image-label + .field").getByRole("button", { name: "Choose…" }).click();
  await (await overlayChooser).setFiles(golden("frames/overlay-rgba.png"));
  await expect(page.getByTestId("overlay-status")).toHaveText("✓ 64 × 48 with transparency");
});

test("output: profiles, quality and the export destination", async ({ page, browserName }) => {
  await ready(page);
  await expect(page.getByLabel("Video profile")).toHaveValue("0");
  await expect(page.getByLabel("Frame rate")).toHaveValue("24");
  await expect(page.getByLabel("Quality")).toHaveValue("high");
  await expect(page.getByLabel("Audio bitrate")).toHaveValue("320k");
  if (browserName === "chromium") await expect(page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" })).toBeVisible();
  else await expect(page.getByTestId("output-status")).toHaveText("Videos are saved to your browser's Downloads folder.");
  await page.getByLabel("Frame rate").fill("90");
  await page.getByLabel("Frame rate").blur();
  await expect(page.getByLabel("Frame rate")).toHaveValue("60");
});

test("live preview draws the visual and follows the profile", async ({ page }) => {
  await ready(page);
  await expect.poll(async () => (await previewPixels(page)).sum).toBeGreaterThan(0);
  expect(await previewPixels(page)).toMatchObject({ width: 64, height: 48 });
  await page.getByLabel("Video profile").selectOption({ label: "Vertical 1080 × 1920" });
  await expect.poll(async () => (await previewPixels(page)).width).toBe(304);
  expect((await previewPixels(page)).height).toBe(540);
});

test("live preview plays with audio and pauses", async ({ page }) => {
  await ready(page, "audio/short-10s-mono.wav");
  const play = page.getByRole("button", { name: "Play preview", exact: true });
  await play.click();
  const pause = page.getByRole("button", { name: "Pause preview", exact: true });
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  await expect(pause).toBeEnabled();
  await expect(page.getByTestId("preview-time")).toHaveText("00:00:01", { timeout: 5000 });
  await pause.click();
  await expect(play).toBeVisible();
});

test("live preview plays from the slider position", async ({ page }) => {
  await ready(page, "audio/short-10s-mono.wav");
  await page.getByLabel("Preview position").fill("5");
  await expect(page.getByTestId("preview-time")).toHaveText("00:00:05");
  await page.getByRole("button", { name: "Play preview", exact: true }).click();
  // From 0 this label would need ~6 s to get here.
  await expect(page.getByTestId("preview-time")).toHaveText("00:00:06", { timeout: 4000 });
  await expect(page.getByRole("button", { name: "Pause preview", exact: true })).toBeVisible();
});

test("seeking the live preview while it plays continues from the new position", async ({ page }) => {
  await ready(page, "audio/short-10s-mono.wav");
  await page.getByRole("button", { name: "Play preview", exact: true }).click();
  await expect(page.getByTestId("preview-time")).toHaveText("00:00:01", { timeout: 5000 });
  await page.getByLabel("Preview position").fill("7");
  await expect(page.getByRole("button", { name: "Pause preview", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("preview-time")).toHaveText("00:00:08", { timeout: 4000 });
});

test("pausing the live preview keeps its position; at the end, play starts over", async ({ page }) => {
  await ready(page, "audio/short-10s-mono.wav");
  const play = page.getByRole("button", { name: "Play preview", exact: true });
  const time = page.getByTestId("preview-time");
  await page.getByLabel("Preview position").fill("4");
  await play.click();
  await expect(time).toHaveText("00:00:05", { timeout: 4000 });
  await page.getByRole("button", { name: "Pause preview", exact: true }).click();
  await expect(play).toBeVisible();
  await expect(time).toHaveText(/00:00:0[56]/);
  await play.click();
  await expect(time).toHaveText("00:00:07", { timeout: 4000 });

  // Run to the end: the position stays there, and Play restarts the snippet.
  await page.getByLabel("Preview position").fill("9.5");
  await expect(play).toBeVisible({ timeout: 5000 });
  await expect(time).toHaveText("00:00:10");
  await play.click();
  await expect(time).toHaveText("00:00:01", { timeout: 4000 });
});

test("Clear resets inputs and effects", async ({ page }) => {
  await ready(page);
  await page.getByLabel("Glitch", { exact: true }).check();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("audio-status")).toHaveCount(0);
  await expect(page.getByTestId("visual-status")).toHaveCount(0);
  await expect(page.getByLabel("Glitch", { exact: true })).toBeDisabled();
  await ready(page);
  await expect(page.getByLabel("Glitch", { exact: true })).not.toBeChecked();
});
