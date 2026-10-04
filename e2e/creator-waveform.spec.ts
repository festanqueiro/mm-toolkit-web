import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));

/** The Video Creator with audio chosen and the selected track's waveform drawn. */
async function open(page: Page, files: string[]) {
  await page.goto("/#/video-creator");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: "Audio" }).getByRole("button", { name: "Choose File(s)…" }).click();
  await (await chooser).setFiles(files.map((name) => golden(`audio/${name}`)));
  await expect(page.getByTestId("waveform")).toBeVisible({ timeout: 15_000 });
}

/** Press on a handle and release at `fraction` of the waveform's width. */
async function dragTo(page: Page, handle: Locator, fraction: number) {
  // Raw mouse events don't scroll: the waveform sits below the fold here.
  await page.getByTestId("waveform").scrollIntoViewIfNeeded();
  const wave = (await page.getByTestId("waveform").boundingBox())!;
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(wave.x + wave.width * fraction, wave.y + wave.height / 2, { steps: 5 });
  await page.mouse.up();
}

/** The snippet region's [left, right] as fractions of the waveform's width, one decimal. */
async function regionSpan(page: Page) {
  const wave = (await page.getByTestId("waveform").boundingBox())!;
  const box = (await page.getByTestId("clip-region").boundingBox())!;
  return [Math.round(((box.x - wave.x) / wave.width) * 10) / 10, Math.round(((box.x + box.width - wave.x) / wave.width) * 10) / 10];
}

const start = (page: Page) => page.getByLabel("Start for track 1");
const duration = (page: Page) => page.getByLabel("Duration for track 1 in seconds");

test("the track's snippet is a region; dragging its handles writes Start and Duration", async ({ page }) => {
  await open(page, ["short-10s-mono.wav"]);
  // Start 0 with the default 60 s covers the whole 10 s file.
  expect(await regionSpan(page)).toEqual([0, 1]);

  await dragTo(page, page.getByRole("slider", { name: "End of short-10s-mono.wav" }), 0.52);
  const dragged = Number(await duration(page).inputValue());
  expect(dragged).toBeGreaterThan(4.7);
  expect(dragged).toBeLessThan(5.5);
  expect(dragged).toBe(Math.round(dragged * 10) / 10);

  // The start handle slides the snippet: Start changes, Duration doesn't.
  await dragTo(page, page.getByRole("slider", { name: "Start of short-10s-mono.wav" }), 0.21);
  await expect(start(page)).toHaveValue("00:00:02");
  await expect(duration(page)).toHaveValue(String(dragged));
  expect(await page.evaluate(() => getSelection()!.type)).not.toBe("Range");
});

test("typing Start and Duration moves the region", async ({ page }) => {
  await open(page, ["short-10s-mono.wav"]);
  await start(page).fill("2");
  await duration(page).fill("4");
  await duration(page).press("Tab");
  await expect.poll(() => regionSpan(page)).toEqual([0.2, 0.6]);
  // A Start that doesn't parse has no region.
  await start(page).fill("abc");
  await expect(page.getByTestId("clip-region")).toHaveCount(0);
});

test("the end handle moves by a second with the arrow keys, ten with Shift", async ({ page }) => {
  await open(page, ["short-10s-mono.wav"]);
  await page.getByRole("slider", { name: "End of short-10s-mono.wav" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(duration(page)).toHaveValue("9");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(duration(page)).toHaveValue("1");
});

test("the waveform and the Preview follow the selected track", async ({ page }) => {
  await open(page, ["short-10s-mono.wav", "drop-30s-stereo.wav"]);
  // Name order: the first track is selected to begin with.
  await expect(page.getByTestId("track-waveform-name")).toHaveText("drop-30s-stereo.wav");
  await expect(page.getByRole("slider", { name: "Start of drop-30s-stereo.wav" })).toBeVisible();

  await page.getByLabel("Start for track 2").focus();
  await expect(page.getByTestId("track-waveform-name")).toHaveText("short-10s-mono.wav");
  await expect(page.getByRole("slider", { name: "Start of short-10s-mono.wav" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("tbody tr").nth(1)).toHaveAttribute("data-selected", "true");

  // The Preview's Track picker is the same selection (it appears once a visual is chosen).
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: "Image or video" }).getByRole("button", { name: "Choose…", exact: true }).click();
  await (await chooser).setFiles(golden("frames/input.png"));
  const picker = page.locator("label.track select");
  await expect(picker).toHaveValue("1");
  await picker.selectOption("0");
  await expect(page.getByTestId("track-waveform-name")).toHaveText("drop-30s-stereo.wav");
  await expect(page.locator("tbody tr").nth(0)).toHaveAttribute("data-selected", "true");
});
