import { expect, test } from "@playwright/test";

const widths = [320, 360, 390, 430, 768, 1024, 1440] as const;

test("home profissional respeita breakpoints sem overflow ou aviso de hidratação", async ({ page }) => {
  test.setTimeout(180_000);
  const hydrationWarnings: string[] = [];
  page.on("console", (message) => {
    if (/hydrated|hydration/i.test(message.text())) hydrationWarnings.push(message.text());
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const benefits = page.locator(".home-benefits").first();
  const footer = page.locator(".site-footer").first();
  await expect(benefits).toHaveCount(1);
  await expect(page.getByText("Para todos os momentos", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Encontre seu estilo", { exact: true })).toHaveCount(0);

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
    if (width === 390) {
      await expect(footer.locator(".footer-group")).toHaveCount(3);
      await expect(footer.locator(".footer-group[open]")).toHaveCount(0);
      await expect(footer.getByRole("link", { name: "Quem somos" })).toBeHidden();
      await footer.locator("summary", { hasText: "Institucional" }).click();
      await expect(footer.getByRole("link", { name: "Quem somos" })).toBeVisible();
    }
    if (width === 1024) {
      await expect(footer.getByRole("link", { name: "Quem somos" })).toBeVisible();
    }
  }

  expect(hydrationWarnings).toEqual([]);
});
