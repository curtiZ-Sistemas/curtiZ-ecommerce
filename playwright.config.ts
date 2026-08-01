import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "store-desktop",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3000" },
      testMatch: /store\.spec\.ts/
    },
    {
      name: "store-mobile",
      use: { ...devices["Pixel 7"], baseURL: "http://localhost:3000" },
      testMatch: /store\.spec\.ts/
    },
    {
      name: "store-responsive",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3000" },
      testMatch: /responsive\.spec\.ts/
    },
    {
      name: "panel-desktop",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3001" },
      testMatch: /panel\.spec\.ts/
    }
  ],
  webServer: [
    {
      command: "npx --no-install next dev --port 3000",
      cwd: "apps/store",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    {
      command: "npx --no-install next dev --port 3001",
      cwd: "apps/panel",
      url: "http://localhost:3001/administracao",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ]
});
