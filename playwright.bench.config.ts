import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 0 benchmark (not part of CI): `npm run bench`. Headless automation is a
 * lower bound — GPU/hardware encoders may be unavailable headless. For real numbers,
 * open /spike.html in a normal browser window.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.bench.ts",
  timeout: 15 * 60_000,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:4173" },
  projects: [
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
