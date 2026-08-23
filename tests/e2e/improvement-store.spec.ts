import { expect, test } from "@playwright/test";

test("normaliza o cadastro e apresenta requisitos de senha", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "curtiz-cookie-consent",
      JSON.stringify({ categories: { essential: true } })
    );
  });
  await page.goto("/cadastro?returnTo=/checkout", { waitUntil: "commit" });
  const name = page.getByLabel("Nome completo");
  const email = page.getByLabel("E-mail", { exact: true });
  const phone = page.getByLabel("Telefone");
  const password = page.getByLabel("Senha", { exact: true });
  const requirements = page.locator("#signup-password-requirements");

  await expect(name).toBeVisible({ timeout: 30_000 });
  await name.fill("  joão-pedro   d'ávila");
  await email.fill(" RAFAEL @EMAIL.COM ");
  await phone.fill("31999990000");

  await expect(name).toHaveValue("João-Pedro D'Ávila");
  await expect(email).toHaveValue("rafael@email.com");
  await expect(phone).toHaveValue("(31) 99999-0000");
  await expect(requirements.getByRole("listitem")).toHaveCount(5);
  await password.fill("123456");
  await expect(
    requirements.getByRole("listitem").filter({ hasText: "Sem sequência ou senha comum" })
  ).not.toHaveClass(/\bmet\b/u);
  await password.fill("SolNorte92!");
  await expect(requirements.locator("li.met")).toHaveCount(5);
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

test("produto exige variante real e mantém a compra compacta", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "curtiz-cookie-consent",
      JSON.stringify({ categories: { essential: true } })
    );
  });
  await page.goto("/produto/flip-flop-wave-preto", { waitUntil: "domcontentloaded" });

  const buyNow = page.getByRole("button", { name: "Comprar agora" });
  const addToCart = page.getByRole("button", { name: "Adicionar ao carrinho" });
  await expect(buyNow).toBeDisabled();
  await expect(addToCart).toBeDisabled();
  await expect(
    page.locator("#main-content").getByText("Escolha um tamanho para continuar.", { exact: true })
  ).toBeVisible();

  await page.getByRole("button", { name: "39/40", exact: true }).click();
  await expect(buyNow).toBeEnabled();
  await expect(addToCart).toBeEnabled();
  await expect(page.getByText("Em estoque", { exact: true })).toBeVisible();

  const layout = await page.locator(".product-detail").evaluate((element) => ({
    width: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(layout.width).toBeLessThanOrEqual(layout.clientWidth);
  await Promise.all([
    page.waitForURL(/\/login\?next=%2Fcheckout%3Forigem%3Dcomprar-agora$/u),
    buyNow.click()
  ]);
  await expect(page.getByRole("heading", { name: "Acesse sua conta" })).toBeVisible();
});
