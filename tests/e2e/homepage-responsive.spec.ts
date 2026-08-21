import { expect, test } from "@playwright/test";

const widths = [320, 360, 390, 430, 768, 1024, 1440] as const;

test("home profissional respeita breakpoints sem overflow ou aviso de hidratação", async ({ page }) => {
  test.setTimeout(180_000);
  const hydrationWarnings: string[] = [];
  page.on("console", (message) => {
    if (/hydrated|hydration/i.test(message.text())) hydrationWarnings.push(message.text());
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const benefits = page.locator(".home-benefits");
  await expect(benefits).toHaveCount(1);

  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 });
    await page.waitForTimeout(60);
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth
    }));
    expect(layout.content, `Home excedeu ${width}px`).toBeLessThanOrEqual(layout.viewport);
    if (width <= 700) await expect(benefits).toBeHidden();
    else await expect(benefits).toBeVisible();
  }

  expect(hydrationWarnings).toEqual([]);
});
