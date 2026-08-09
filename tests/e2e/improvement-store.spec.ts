import { expect, test } from "@playwright/test";

test("normaliza o cadastro e apresenta requisitos de senha", async ({ page }) => {
  await page.goto("/cadastro?returnTo=/checkout");
  await page.getByLabel("Nome completo").fill("  joão-pedro   d'ávila");
  await page.getByLabel("E-mail").fill(" RAFAEL @EMAIL.COM ");
  await page.getByLabel("Telefone").fill("31999990000");

  await expect(page.getByLabel("Nome completo")).toHaveValue("João-Pedro D'Ávila");
  await expect(page.getByLabel("E-mail")).toHaveValue("rafael@email.com");
  await expect(page.getByLabel("Telefone")).toHaveValue("31999990000");
  await expect(page.getByText("Mínimo de 6 caracteres")).toBeVisible();
  await expect(page.getByRole("link", { name: /Já tenho uma conta/i })).toHaveAttribute(
    "href",
    "/login?returnTo=%2Fcheckout"
  );
});

test("filtra no servidor, mantém URL e permite remover chips", async ({ page, isMobile }) => {
  await page.goto("/produtos");
  await expect(page.getByText(/produtos encontrados/i)).toBeVisible();
  const rejectCookies = page.getByRole("button", { name: "Rejeitar opcionais" });
  await expect(rejectCookies).toBeVisible({ timeout: 10_000 });
  await rejectCookies.click();

  const filters = isMobile
    ? page.getByRole("dialog", { name: "Filtros" })
    : page.getByRole("complementary", { name: "Filtros do catálogo" });
  if (isMobile) await page.getByRole("button", { name: /Filtrar/i }).click();
  await filters.getByLabel("Preto").click();
  await expect(page).toHaveURL(/cores=Preto/);
  if (isMobile) await page.getByRole("button", { name: /Ver \d+ produtos/i }).click();
  const chip = page.getByRole("button", { name: "Preto", exact: true });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).not.toHaveURL(/cores=Preto/);
});

test("checkout direto exige login e preserva o carrinho", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "curtiz-demo-cart",
      JSON.stringify([
        {
          productId: "wave-preto",
          slug: "flip-flop-wave-preto",
          variantId: "wave-preto:Preto:39/40",
          name: "curti Z Flip-Flop Wave Preto",
          image: "/images/products/wave-preto.png",
          color: "Preto",
          size: "39/40",
          quantity: 1,
          maxQuantity: 10,
          unitPriceInCents: 5990
        }
      ])
    );
  });
  await page.goto("/checkout");
  await expect(page).toHaveURL(/\/login\?next=%2Fcheckout/);
  await page.goto("/carrinho");
  await expect(page.getByRole("heading", { name: "curti Z Flip-Flop Wave Preto" })).toBeVisible();
});

test("drawer mobile cabe na viewport e fecha com Escape", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/produtos");
  await page.getByRole("button", { name: /Filtrar/i }).click();
  await expect(page.getByRole("dialog", { name: "Filtros" })).toBeVisible();
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Filtros" })).toBeHidden();
});
