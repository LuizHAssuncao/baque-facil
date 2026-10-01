import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/offline",
  outputDir: "test-results/offline",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/offline" }]],
  use: {
    baseURL: "http://127.0.0.1:4335",
    serviceWorkers: "allow",
    channel: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? undefined : "chrome",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tests/offline/server.mjs",
    url: "http://127.0.0.1:4335",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [{ name: "offline-chromium", use: { ...devices["Desktop Chrome"] } }],
});
