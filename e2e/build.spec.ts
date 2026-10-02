import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const assets = fileURLToPath(new URL("../dist/assets/", import.meta.url));

/**
 * WebKit evaluates a worker entry that another chunk imports as a second instance (duplicate
 * Mediabunny, duplicate `onmessage`). No chunk may import the job worker's entry module.
 */
test("no chunk imports the job worker's entry module", async ({ browserName }) => {
  test.skip(browserName !== "chromium", "Checks the build output once.");
  const files = readdirSync(assets).filter((f) => f.endsWith(".js"));
  const entry = files.find((f) => f.startsWith("job.worker-"));
  expect(entry).toBeTruthy();
  const importers = files.filter((f) => f !== entry && readFileSync(`${assets}${f}`, "utf8").includes(`./${entry}`));
  expect(importers).toEqual([]);
  // The entry itself imports nothing statically.
  expect(readFileSync(`${assets}${entry}`, "utf8")).not.toMatch(/^import[^(]/m);
});
