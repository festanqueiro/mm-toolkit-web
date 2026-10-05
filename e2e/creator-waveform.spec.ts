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

test("the waveform is kept while another tab is open, not decoded again", async ({ page }) => {
  // Count the waveform requests sent to the media Worker.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    (window as unknown as { peakRequests: number }).peakRequests = 0;
    Worker.prototype.postMessage = function (this: Worker, message: { op?: string }, ...rest: unknown[]) {
      if (message?.op === "peaks") (window as unknown as { peakRequests: number }).peakRequests++;
      return (post as (...args: unknown[]) => void).call(this, message, ...rest);
    } as typeof post;
  });
  await open(page, ["short-10s-mono.wav"]);
  await page.getByRole("link", { name: "Media Cutter" }).click();
  await expect(page.getByTestId("waveform")).toHaveCount(0);
  await page.getByRole("link", { name: "Video Creator" }).click();
  await expect(page.getByTestId("waveform")).toBeVisible();
  await expect(page.getByTestId("clip-region")).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { peakRequests: number }).peakRequests)).toBe(1);
});

/** Press at `from` of the waveform's width (plus `nudge` pixels) and release at `to`; `during` runs before the release. */
async function pressAndDrag(page: Page, from: number, nudge: number, to: number, during?: () => Promise<void>) {
  await page.getByTestId("waveform").scrollIntoViewIfNeeded();
  const wave = (await page.getByTestId("waveform").boundingBox())!;
  const y = wave.y + wave.height / 2;
  await page.mouse.move(wave.x + wave.width * from + nudge, y);
  await page.mouse.down();
  await page.mouse.move(wave.x + wave.width * to + nudge, y, { steps: 5 });
  await during?.();
  await page.mouse.up();
}

test("dragging the snippet itself slides it, keeping its Duration", async ({ page }) => {
  await open(page, ["short-10s-mono.wav"]);
  await start(page).fill("2");
  await duration(page).fill("4");
  await duration(page).press("Tab");
  await expect.poll(() => regionSpan(page)).toEqual([0.2, 0.6]);
  // Grab the middle of the snippet and move it 3 s to the right.
  await pressAndDrag(page, 0.4, 0, 0.7);
  await expect(start(page)).toHaveValue("00:00:05");
  await expect(duration(page)).toHaveValue("4");
  expect(await regionSpan(page)).toEqual([0.5, 0.9]);
});

test("a handle is grabbed by pressing just inside the snippet, and shows its value while dragged", async ({ page }) => {
  await open(page, ["short-10s-mono.wav"]);
  await start(page).fill("2");
  await duration(page).fill("6");
  await duration(page).press("Tab");
  await expect.poll(() => regionSpan(page)).toEqual([0.2, 0.8]);
  await pressAndDrag(page, 0.8, -5, 0.6, async () => {
    await expect(page.getByTestId("handle-time")).toHaveText("4 s");
  });
  await expect(duration(page)).toHaveValue("4");
  await expect(start(page)).toHaveValue("2");
  await pressAndDrag(page, 0.2, 5, 0.3, async () => {
    await expect(page.getByTestId("handle-time").first()).toHaveText("00:00:03");
  });
  await expect(start(page)).toHaveValue("00:00:03");
});
