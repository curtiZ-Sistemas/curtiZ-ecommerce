import { expect, test } from "@playwright/test";

test("recovery link keeps its token out of URLs and uses one protected POST", async ({ page }) => {
  const tokenHash = "a".repeat(64);
  const urls: string[] = [];
  let verifications = 0;
  page.on("request", request => urls.push(request.url()));
  await page.route("**/api/auth/recovery/verify", async route => {
    verifications += 1;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ tokenHash });
    await route.fulfill({ status: 422, contentType: "application/json",
      body: JSON.stringify({ message: "Invalid synthetic test token" }) });
  });
  const response = await page.goto("/auth/recovery#token_hash=" + tokenHash);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page).toHaveURL(/\/auth\/recovery$/u);
  await expect(page.getByRole("link", { name: "Solicitar novo link" })).toBeVisible();
  expect(verifications).toBe(1);
  expect(urls.some(url => url.includes(tokenHash))).toBe(false);
  await expect(page.getByLabel("E-mail da conta")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
