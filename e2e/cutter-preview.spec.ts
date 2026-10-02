import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const media = (name: string) => fileURLToPath(new URL(`../fixtures/media/${name}`, import.meta.url));

/**
 * Native codec support differs by engine and platform (WebKitGTK's GStreamer plays MKV and
 * AIFF; macOS WebKit doesn't play MKV), so make the native element fail everywhere: the
 * fallback paths are then tested in every engine.
 */
async function breakNativePlayback(page: Page) {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      for (const el of document.querySelectorAll<HTMLMediaElement>("audio, video")) {
        if (el.dataset.broken) continue;
        el.dataset.broken = "1";
        el.src = "data:application/x-unplayable,";
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function choose(page: Page, name: string) {
  await breakNativePlayback(page);
  await page.goto("/#/cutter");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: "Source" }).getByRole("button", { name: "Choose…" }).click();
  await (await chooser).setFiles(media(name));
}

/** Seconds shown in the `HH:MM:SS / HH:MM:SS` label. */
const shownTime = async (page: Page) => {
  const [h, m, s] = (await page.getByTestId("player-time").textContent())!.split(" / ")[0]!.split(":").map(Number);
  return h! * 3600 + m! * 60 + s!;
};

test("audio the browser can't play gets a waveform with playback, seeking and clip preview", async ({ page }) => {
  await choose(page, "short-10s-mono.aiff");
  await expect(page.getByTestId("player-time")).toHaveText("00:00:00 / 00:00:10", { timeout: 15_000 });
  await expect(page.getByTestId("player")).toHaveAttribute("data-mode", "waveform");
  await expect(page.getByTestId("waveform")).toBeVisible();

  await page.getByLabel("Timeline").fill("4");
  await expect(page.getByTestId("player-time")).toHaveText("00:00:04 / 00:00:10");
  await page.getByRole("button", { name: "Set Start" }).click();
  await expect(page.getByLabel("Start for clip 1")).toHaveValue("00:00:04");

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect.poll(() => shownTime(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(5);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  // ▶ on a row plays [start, start + duration) and stops by itself.
  await page.getByLabel("Start for clip 1").fill("2");
  await page.getByLabel("Duration for clip 1").fill("1");
  await page.getByRole("button", { name: "Play clip 1" }).click();
  await expect(page.getByRole("button", { name: "Stop clip 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play clip 1" })).toBeVisible({ timeout: 10_000 });
  expect(await shownTime(page)).toBe(3);
});

test("video the browser can't play is previewed as decoded frames", async ({ page }) => {
  await choose(page, "clip-3s-320x240.mkv");
  await expect(page.getByTestId("player-time")).toHaveText("00:00:00 / 00:00:03", { timeout: 15_000 });
  await expect(page.getByTestId("player")).toHaveAttribute("data-mode", "frames");

  const canvas = page.locator("canvas.frames");
  const pixels = () =>
    canvas.evaluate((c: HTMLCanvasElement) => {
      const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 997) sum += data[i]!;
      return { width: c.width, sum };
    });
  await expect.poll(async () => (await pixels()).sum).toBeGreaterThan(0);
  expect((await pixels()).width).toBe(320);
  const first = (await pixels()).sum;
  // testsrc's counter changes every second: a seek draws a different frame.
  await page.getByLabel("Timeline").fill("2.5");
  await expect.poll(async () => (await pixels()).sum).not.toBe(first);

  await page.getByLabel("Timeline").fill("0");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => shownTime(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
});
