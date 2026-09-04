import { defineConfig, devices } from "@playwright/test";

const storefrontOnly = process.env.STOREFRONT_E2E_ONLY === "true";
const storefrontUrl = process.env.STOREFRONT_E2E_URL ?? "http://localhost:3000";
const startsLocalStore = new URL(storefrontUrl).hostname === "localhost";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
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
      use: { ...devices["Desktop Chrome"], baseURL: storefrontUrl },
      testMatch: /store\.spec\.ts/
    },
    {
      name: "store-mobile",
      use: { ...devices["Pixel 7"], baseURL: storefrontUrl },
      testMatch: /store\.spec\.ts/
    },
    {
      name: "store-responsive",
      use: { ...devices["Desktop Chrome"], baseURL: storefrontUrl },
      testMatch: /responsive\.spec\.ts/
    },
    {
      name: "panel-desktop",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3001" },
      testMatch: /panel\.spec\.ts/
    }
  ],
  webServer: [
    ...(startsLocalStore
      ? [{
          command: "npx --no-install next dev --port 3000",
          cwd: "apps/store",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000
        }]
      : []),
    ...(!storefrontOnly
      ? [
          {
            command: "npx --no-install next dev --port 3001",
            cwd: "apps/panel",
            url: "http://localhost:3001",
            reuseExistingServer: !process.env.CI,
            timeout: 120_000
          }
        ]
      : [])
  ]
});
