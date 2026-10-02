import { expect, test } from "@playwright/test";
import { serveDist } from "./helpers";

const controlled = { timeout: 30_000 };

test("a shell that references assets outside its version is refused, then the real one installs", async ({ page }) => {
  test.slow();
  // The bug: a stale (HTTP-cached) index.html precached with a newer version's assets.
  let stale = true;
  const server = await serveDist((path, body) =>
    stale && (path === "/" || path === "/index.html") ? Buffer.from(body.toString().replace(/assets\/main-[^"]+\.js/, "assets/main-STALE.js")) : body,
  );
  try {
    await page.goto(`${server.origin}/#/about`);
    test.skip(!(await page.evaluate(() => "serviceWorker" in navigator)), "No service workers here.");
    // Install fails: no worker ever controls the page, nothing is cached.
    await page.waitForTimeout(4000);
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(false);
    expect(await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("mm-toolkit-")))).toEqual([]);
    // The real shell installs and takes control.
    stale = false;
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, controlled);
    await expect(page.getByRole("link", { name: "MM Toolkit home" })).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("a new version takes over by itself; the open page offers Reload and keeps working", async ({ page }) => {
  test.slow();
  let version: string | null = null;
  const server = await serveDist((path, body) => (version && path === "/sw.js" ? Buffer.from(body.toString().replace(/const VERSION = "[^"]+"/, `const VERSION = "${version}"`)) : body));
  try {
    await page.goto(`${server.origin}/#/about`);
    test.skip(!(await page.evaluate(() => "serviceWorker" in navigator)), "No service workers here.");
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, controlled);
    await expect(page.getByTestId("update-banner")).toHaveCount(0);

    // Deploy "99.0.0" (same files, new worker): no click needed for it to activate.
    version = "99.0.0";
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.getByTestId("update-banner")).toBeVisible(controlled);
    const keys = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("mm-toolkit-")).sort());
    expect(keys).toHaveLength(2); // the previous version is kept for open pages
    expect(keys).toContain("mm-toolkit-99.0.0");

    // The open page still works (navigates and lazy-loads), then Reload switches versions.
    await page.evaluate(() => (location.hash = "#/cutter"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Media Cutter");
    await page.getByTestId("update-banner").getByRole("button", { name: "Reload" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Media Cutter");
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
  } finally {
    await server.stop();
  }
});
