import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));
const media = (name: string) => fileURLToPath(new URL(`../fixtures/media/${name}`, import.meta.url));

async function pick(page: Page, scope: string, button: string, path: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: scope }).getByRole("button", { name: button, exact: true }).first().click();
  await (await chooser).setFiles(path);
}

/** Each page, in a populated state where it has one. */
const pages: Record<string, (page: Page) => Promise<void>> = {
  home: async (page) => void (await page.goto("/")),
  "video-creator": async (page) => {
    await page.goto("/#/video-creator");
    await pick(page, "Input", "Choose File…", golden("audio/short-10s-mono.wav"));
    await pick(page, "Input", "Choose…", media("visual-320x240.png"));
    await expect(page.getByTestId("visual-status")).toHaveText("✓ Image ready.");
    await page.getByRole("button", { name: "Audio timestamps" }).click();
  },
  "video-creator effects": async (page) => {
    await pages["video-creator"]!(page);
    await page.getByRole("button", { name: "Visual Effects" }).click();
  },
  cutter: async (page) => {
    await page.goto("/#/cutter");
    await pick(page, "Input", "Choose…", golden("audio/short-10s-mono.wav"));
    await expect(page.getByTestId("source-status")).toHaveText("✓ Source audio ready.");
  },
  converter: async (page) => {
    await page.goto("/#/converter");
    await pick(page, "Input", "Choose Audio or Video Files…", golden("audio/short-10s-mono.wav"));
    await expect(page.getByTestId("input-status")).toHaveText("✓ 1 audio file ready.");
  },
  stems: async (page) => void (await page.goto("/#/stems")),
  history: async (page) => void (await page.goto("/#/history")),
  settings: async (page) => void (await page.goto("/#/settings")),
  about: async (page) => void (await page.goto("/#/about")),
};

for (const scheme of ["light", "dark"] as const) {
  for (const [name, open] of Object.entries(pages)) {
    test(`${name} (${scheme}) has no axe violations`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "Audited once (axe results don't depend on the engine).");
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      console.log(`AXE ${name} ${scheme}: ${summary.length ? "\n  " + summary.join("\n  ") : "clean"}`);
      expect(summary).toEqual([]);
    });
  }
}
