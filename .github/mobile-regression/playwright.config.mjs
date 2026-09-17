import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".github/mobile-regression",
  testMatch: "mobile.spec.mjs",
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]] : "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "android-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "iphone-webkit",
      use: { ...devices["iPhone 14"] },
    },
  ],
});
