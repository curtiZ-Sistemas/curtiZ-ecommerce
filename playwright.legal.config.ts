import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /legal-policy\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  reporter: "list",
  use: { baseURL: "http://localhost:3001", headless: true, screenshot: "only-on-failure" },
  webServer: {
    command: "pnpm.cmd exec next dev --webpack --port 3001",
    cwd: "apps/panel",
    url: "http://localhost:3001",
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      APP_ENV: "development",
      DEMO_MODE: "true",
      DEMO_SESSION_SECRET: "legal-policy-isolated-test-session-secret",
      SUPABASE_URL: "",
      SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_PANEL_URL: "http://localhost:3001",
      NEXT_PUBLIC_STORE_URL: "http://localhost:3000"
    }
  }
});
