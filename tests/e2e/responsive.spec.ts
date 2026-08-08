import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const viewports = [
  { width: 320, height: 720 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 860 },
  { width: 430, height: 880 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 }
] as const;

const routes = [
  "/",
  "/produtos",
  "/produto/flip-flop-wave-preto",
  "/favoritos",
  "/carrinho",
  "/checkout",
  "/login",
  "/ajuda"
] as const;

test("não cria rolagem horizontal nas telas principais", async ({ page }) => {
  test.setTimeout(240_000);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toBeVisible();
      const overflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth
      }));
      expect(
        overflow.content,
        `${route} excedeu ${viewport.width}px: ${overflow.content}px`
      ).toBeLessThanOrEqual(overflow.viewport);
    }
  }
});

test("cabeçalho mobile mantém marca e ações dentro da tela", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [320, 360, 375, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Abrir menu" })).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: /curti Z — página inicial/i })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Entrar na minha conta/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Carrinho com/i })).toBeVisible();
  }
});

test("menu de categorias mobile permanece dentro da viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Abrir menu" });
  await expect(async () => {
    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  const menu = page.getByRole("dialog", { name: "Menu principal" });
  await expect(menu).toBeVisible();
  expect(await menu.getByRole("link").count()).toBeGreaterThanOrEqual(8);
  const behavior = await menu.evaluate((element) => {
    return {
      menuWidth: element.getBoundingClientRect().width,
      viewport: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth
    };
  });
  expect(behavior.menuWidth).toBeLessThanOrEqual(behavior.viewport);
  expect(behavior.pageWidth).toBeLessThanOrEqual(behavior.viewport);
});

test("busca mobile mostra sugestões sem ultrapassar a viewport", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  const searchButton = page.locator(".header-search-toggle");
  await expect(async () => {
    await searchButton.click();
    await expect(searchButton).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.locator('input[role="combobox"]:visible').fill("wave");

  await expect(page.getByText("Sugestões")).toBeVisible();
  await expect(
    page.getByRole("option", { name: /curti Z Flip-Flop Wave Preto Masculino/i })
  ).toBeVisible();
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
});

test("chatbot mobile usa somente o ícone e respeita a viewport", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "curtiz-cookie-consent",
      JSON.stringify({ categories: { essential: true } })
    );
  });
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 430, height: 880 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const launcher = page.getByRole("button", { name: "Abrir ajuda" });
    await expect(launcher.getByText("Posso ajudar?")).toBeHidden();
    const launcherBox = await launcher.boundingBox();
    expect(launcherBox).not.toBeNull();
    expect(
      viewport.height - (launcherBox?.y ?? 0) - (launcherBox?.height ?? 0)
    ).toBeLessThanOrEqual(20);

    await launcher.click();
    const dialog = page.getByRole("dialog", { name: "Ajuda Curtiz" });
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox?.y ?? 0).toBeGreaterThanOrEqual(10);
    expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThan(viewport.height);
  }
});
