import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Device presets spoof the user agent, so record the real one too.
test.use({ userAgent: undefined });

test("render a 60 s 1080×1920 promo with bass blur", async ({ page }, info) => {
  await page.goto("/spike.html");
  await page.getByRole("button", { name: "Render" }).click();
  const result = page.getByTestId("result");
  await expect(result).toBeVisible({ timeout: 14 * 60_000 });
  const json = JSON.parse((await result.textContent()) ?? "{}") as Record<string, unknown>;
  mkdirSync("test-results/bench", { recursive: true });
  writeFileSync(`test-results/bench/${info.project.name}.json`, JSON.stringify(json, null, 2));
  console.log(`[${info.project.name}]`, JSON.stringify(json));
  expect(json.error, String(json.details ?? "")).toBeUndefined();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download MP4" }).click();
  await (await download).saveAs(`test-results/bench/${info.project.name}.mp4`);
});
