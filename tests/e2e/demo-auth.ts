import { expect, type BrowserContext, type Page } from "@playwright/test";

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
// Each worker authenticates through the real local endpoint once per account.
// Reuse its signed session for setup; login/logout UI tests still authenticate afresh.
const sessions = new Map<string, Cookies>();

export async function loginDemoAccount(page: Page, email: string) {
  const existing = sessions.get(email);
  if (existing) {
    await page.context().addCookies(existing);
    return;
  }
  const response = await page.request.post("http://localhost:3000/api/auth/login", {
    headers: { origin: "http://localhost:3000" },
    data: { email, password: "1234567890" }
  });
  expect(response.ok(), `Login demo falhou com HTTP ${response.status()}`).toBe(true);
  const cookies = (await page.context().cookies("http://localhost:3000"))
    .filter((cookie) => cookie.name === "curtiz-demo-session");
  expect(cookies).toHaveLength(1);
  sessions.set(email, cookies);
}
