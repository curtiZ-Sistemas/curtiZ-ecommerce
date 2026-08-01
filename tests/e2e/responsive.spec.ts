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

const routes = ["/", "/produtos", "/carrinho", "/checkout", "/login", "/ajuda"] as const;

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
      page.getByRole("banner").getByRole("link", { name: /Curtiz — página inicial/i })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Entrar na minha conta/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Carrinho com/i })).toBeVisible();
  }
});

test("carrossel de estilos usa scroll nativo e mantém os vizinhos visíveis", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  const carousel = page.getByRole("list", { name: /Arraste horizontalmente/i });
  await expect(carousel).toBeVisible();
  await expect(carousel.getByRole("listitem")).toHaveCount(4);
  const behavior = await carousel.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      scrollable: element.scrollWidth > element.clientWidth,
      snap: style.scrollSnapType,
      overflow: style.overflowX
    };
  });
  expect(behavior.scrollable).toBe(true);
  expect(behavior.snap).toMatch(/(x|inline)/);
  expect(["auto", "scroll"]).toContain(behavior.overflow);
});

test("busca mobile mostra sugestões sem ultrapassar a viewport", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "Abrir busca" }).click();
  await page.getByRole("searchbox", { name: "Buscar produtos" }).fill("wave");

  await expect(page.getByText("Produtos encontrados")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Curtiz Flip-Flop Wave Preto Masculino/i })
  ).toBeVisible();
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
});
