import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.RELAY_BASE_URL || "http://127.0.0.1:3001",
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    viewport: { width: 1536, height: 1024 },
    trace: "off",
  },
});
