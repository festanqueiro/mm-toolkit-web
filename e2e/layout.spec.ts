import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { mockFolderPicker } from "./helpers";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));

async function convertOne(page: Page, browserName: string, format = "wav") {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose Audio or Video Files…" }).click();
  await (await chooser).setFiles(golden("audio/short-10s-mono.wav"));
  await page.getByLabel("Convert to").selectOption(format);
  if (browserName === "chromium") await page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" }).click();
  const download = browserName === "chromium" ? null : page.waitForEvent("download");
  await page.getByRole("button", { name: "Convert Files" }).click();
  await download;
  await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 conversion", { timeout: 60_000 });
}

test("the rail holds export, action and results; results play and download", async ({ page, browserName }) => {
  if (browserName === "chromium") await mockFolderPicker(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/converter");
  const rail = page.getByRole("complementary", { name: "Output" });
  await expect(rail.getByRole("region", { name: "Export" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Convert Files" })).toBeVisible();
  await convertOne(page, browserName);
  const results = rail.getByRole("list", { name: "Results" });
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(results.locator("audio")).toHaveCount(1);
  await expect(page.getByTestId("results-saved")).toContainText(browserName === "chromium" ? "Saved to exports-test" : "Downloaded");
  const download = page.waitForEvent("download");
  await results.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("short-10s-mono.wav");

  // A new job replaces the results; Clear empties them.
  await convertOne(page, browserName, "flac");
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(results).toContainText("short-10s-mono.flac");
  await rail.getByRole("button", { name: "Clear" }).click();
  await expect(rail.getByRole("list", { name: "Results" })).toHaveCount(0);
});

test("the rail stays in view while the setup scrolls (wide screens)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto("/#/converter");
  // The button must live in the rail (today's sticky footer would also stay in view).
  const button = page.getByRole("complementary", { name: "Output" }).getByRole("button", { name: "Convert Files" });
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(300);
  // The page really scrolled, yet the rail's button is still fully in view (it slid up to
  // its sticky offset below the site header and stayed there).
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const box = (await button.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
});

test("narrow screens: one column, the action in a bottom bar, no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/#/converter");
  await expect(page.getByTestId("action-bar").getByRole("button", { name: "Convert Files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Convert Files" })).toHaveCount(1);
  await expect(page.getByTestId("requirements")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
