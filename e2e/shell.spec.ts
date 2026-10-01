import { expect, test } from "@playwright/test";

const tabs = ["Video Creator", "Media Cutter", "Media Converter", "History", "Settings", "About"];

test("shows all tabs in desktop order and defaults to Video Creator", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Tools" }).getByRole("link")).toHaveText(tabs);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Video Creator");
});

test("hash routes survive reload", async ({ page }) => {
  await page.goto("/#/converter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Media Converter");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Media Converter");
});

test("About shows version and this browser's capabilities", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.getByText(/^Version \d+\.\d+\.\d+$/)).toBeVisible();
  await expect(page.getByTestId("capabilities").getByRole("listitem")).toHaveCount(6);
});
