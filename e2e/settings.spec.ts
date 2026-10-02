import { expect, test } from "@playwright/test";
import { waitForStored } from "./helpers";

test("naming templates validate live and persist across reloads", async ({ page }) => {
  await page.goto("/#/settings");
  const promo = page.getByLabel("Generated video filename");
  await expect(promo).toHaveValue("{track} - Promo Snippet");
  await expect(page.locator("#promo-naming-example")).toHaveText("e.g. My Song - Promo Snippet.mp4");

  await promo.fill("{number:02d} {track}");
  await expect(page.locator("#promo-naming-example")).toHaveText("e.g. 01 My Song.mp4");
  await promo.press("Enter");

  await page.getByLabel("Clip filename").fill("{missing}");
  await expect(page.locator("#clip-naming-example")).toHaveText(
    "Invalid clip naming template. Use {source}, {title}, and {number}.",
  );

  await waitForStored(page, "general/promo_naming", "{number:02d} {track}");
  await page.reload();
  await expect(page.getByLabel("Generated video filename")).toHaveValue("{number:02d} {track}");
});

test("emptied template falls back to the desktop default", async ({ page }) => {
  await page.goto("/#/settings");
  const clip = page.getByLabel("Clip filename");
  await clip.fill("   ");
  await clip.blur();
  await expect(clip).toHaveValue("{source} - {title}");
});

test("theme setting applies and persists", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByLabel("Theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await waitForStored(page, "web/theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Theme").selectOption("system");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
});

test("export folder controls follow browser capability", async ({ page }) => {
  await page.goto("/#/settings");
  const status = page.getByTestId("default-output-status");
  const hasPicker = await page.evaluate(() => typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function");
  if (hasPicker) {
    await expect(page.getByRole("button", { name: "Choose…" })).toBeVisible();
    await expect(page.getByLabel("Existing files")).toHaveValue("rename");
    await expect(status).toHaveText("Optional: choose a writable folder to prefill exports.");
  } else {
    await expect(status).toContainText("Your browser saves exports to its Downloads folder.");
    await expect(page.getByLabel("Existing files")).toHaveCount(0);
  }
});
