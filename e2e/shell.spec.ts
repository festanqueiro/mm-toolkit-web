import { expect, test } from "@playwright/test";

const tabs = ["Video Creator", "Media Cutter", "Media Converter", "Stem Splitter", "History", "Settings", "About"];

test("shows all tabs (desktop order, then web-only tools) and opens on Home", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Tools" }).getByRole("link")).toHaveText(tabs);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Audio & video tools, right in your browser");
  await expect(page).toHaveTitle("MM Toolkit");
});

test("Home lists every tool as a card that opens it; the logo goes back Home", async ({ page }) => {
  await page.goto("/");
  const cards = page.getByRole("list", { name: "Tools" }).getByRole("link");
  await expect(cards).toHaveCount(4);
  for (const [title, heading] of [
    ["Video Creator", "Video Creator"],
    ["Media Cutter", "Media Cutter"],
    ["Media Converter", "Media Converter"],
    ["Stem Splitter", "Stem Splitter"],
  ]) {
    const card = cards.filter({ hasText: `Open ${title}` });
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading!);
    await page.getByRole("link", { name: "MM Toolkit home" }).click();
    await expect(cards).toHaveCount(4);
  }
  // Unknown routes land on Home.
  await page.goto("/#/nope");
  await expect(cards).toHaveCount(4);
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
