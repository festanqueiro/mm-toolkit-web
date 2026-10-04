import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));

/** The Cutter with the 10 s fixture loaded and its waveform drawn. */
async function open(page: Page) {
  await page.goto("/#/cutter");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: "Source" }).getByRole("button", { name: "Choose…" }).click();
  await (await chooser).setFiles(golden("audio/short-10s-mono.wav"));
  await expect(page.getByTestId("waveform")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("player-time")).toHaveText("00:00:00 / 00:00:10");
}

/** Press on a handle and release at `fraction` of the waveform's width. */
async function dragTo(page: Page, handle: Locator, fraction: number) {
  const wave = (await page.getByTestId("waveform").boundingBox())!;
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(wave.x + wave.width * fraction, wave.y + wave.height / 2, { steps: 5 });
  await page.mouse.up();
}

/** Each region's [left, right] as fractions of the waveform's width, one decimal. */
async function regionSpans(page: Page) {
  const wave = (await page.getByTestId("waveform").boundingBox())!;
  const spans: [number, number][] = [];
  for (const region of await page.getByTestId("clip-region").all()) {
    const box = (await region.boundingBox())!;
    spans.push([Math.round(((box.x - wave.x) / wave.width) * 10) / 10, Math.round(((box.x + box.width - wave.x) / wave.width) * 10) / 10]);
  }
  return spans;
}

test("dragging the handles on the waveform writes the clip's Start and End", async ({ page }) => {
  await open(page);
  // The default row (start 0, 60 s) covers the whole 10 s track.
  expect(await regionSpans(page)).toEqual([[0, 1]]);

  await dragTo(page, page.getByRole("slider", { name: "End of Clip 01" }), 0.52);
  await expect(page.getByLabel("End for clip 1")).toHaveValue("00:00:05");
  await dragTo(page, page.getByRole("slider", { name: "Start of Clip 01" }), 0.21);
  await expect(page.getByLabel("Start for clip 1")).toHaveValue("00:00:02");
  expect(await regionSpans(page)).toEqual([[0.2, 0.5]]);
  await expect(page.getByTestId("clip-status")).toHaveText("✓ 1 clip ready.");

  // Start can't cross End: it stops a second before it.
  await dragTo(page, page.getByRole("slider", { name: "Start of Clip 01" }), 0.9);
  await expect(page.getByLabel("Start for clip 1")).toHaveValue("00:00:04");
});

test("every clip is a region; the current one has the handles and follows its fields", async ({ page }) => {
  await open(page);
  await page.getByLabel("Start for clip 1").fill("2");
  await page.getByLabel("End for clip 1").fill("4");
  await page.getByRole("button", { name: "Add clip" }).click();
  await page.getByLabel("Start for clip 2").fill("6");
  await page.getByLabel("Duration for clip 2").fill("2");
  expect(await regionSpans(page)).toEqual([
    [0.2, 0.4],
    [0.6, 0.8],
  ]);
  await expect(page.getByRole("slider", { name: "Start of Clip 02" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Start of Clip 01" })).toHaveCount(0);

  // Clicking inside another clip's region makes that row current.
  const wave = (await page.getByTestId("waveform").boundingBox())!;
  await page.mouse.click(wave.x + wave.width * 0.3, wave.y + wave.height / 2);
  await expect(page.getByTestId("editing")).toHaveText("Editing: Clip 01");
  await expect(page.getByRole("slider", { name: "Start of Clip 01" })).toBeVisible();

  // A row that doesn't resolve has no region.
  await page.getByLabel("Start for clip 2").fill("");
  expect(await regionSpans(page)).toEqual([[0.2, 0.4]]);
});

test("handles move by a second with the arrow keys, ten with Shift", async ({ page }) => {
  await open(page);
  const end = page.getByRole("slider", { name: "End of Clip 01" });
  await end.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByLabel("End for clip 1")).toHaveValue("00:00:09");
  await expect(end).toHaveAttribute("aria-valuetext", "00:00:09");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.getByLabel("End for clip 1")).toHaveValue("00:00:01");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("End for clip 1")).toHaveValue("00:00:02");
});

test("the waveform's space is held while it loads, so the controls below don't move", async ({ page }) => {
  await page.goto("/#/cutter");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: "Source" }).getByRole("button", { name: "Choose…" }).click();
  await (await chooser).setFiles(golden("audio/short-10s-mono.wav"));
  const timeline = page.getByLabel("Timeline");
  await expect(timeline).toBeVisible();
  const before = (await timeline.boundingBox())!.y;
  await expect(page.getByTestId("waveform")).toBeVisible({ timeout: 15_000 });
  expect((await timeline.boundingBox())!.y).toBe(before);
});
