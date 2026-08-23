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
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 }
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
  test.setTimeout(480_000);
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
    const brand = page.getByRole("banner").getByRole("link", { name: /curti Z — página inicial/i });
    await expect(brand).toBeVisible();
    expect(
      await brand.evaluate((element) => element.getBoundingClientRect().width)
    ).toBeGreaterThanOrEqual(width <= 380 ? 112 : 120);
    await expect(page.getByRole("link", { name: /Entrar na minha conta/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Carrinho com/i })).toBeVisible();
  }
});

test("cabeçalho permanece bordô e estável durante a rolagem", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const header = page.locator(".site-header");
    await expect(header).toHaveCSS("background-color", "rgb(98, 19, 15)");

    const samples: Array<{ height: number; top: number; className: string }> = [];
    for (const scrollY of [0, 20, 40, 120, 360, 40, 0]) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), scrollY);
      await page.waitForTimeout(40);
      samples.push(
        await header.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            height: bounds.height,
            top: bounds.top,
            className: element.getAttribute("class") ?? ""
          };
        })
      );
    }

    expect(new Set(samples.map((sample) => sample.className))).toEqual(new Set(["site-header"]));
    expect(
      Math.max(...samples.map((sample) => sample.height)) -
        Math.min(...samples.map((sample) => sample.height))
    ).toBeLessThan(1);
    expect(samples.every((sample) => Math.abs(sample.top) < 1)).toBe(true);
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

test("busca mobile recomenda produtos reais quando não encontra correspondência", async ({ page }) => {
  await page.route("**/api/catalog?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        products: [], total: 0, page: 1, pageSize: 5, source: "demo",
        facets: { categories: [], collections: [], colors: [], sizes: [], price: { min: 0, max: 0 }, promotionCount: 0, inStockCount: 0, newestCount: 0 }
      })
    });
  });
  await page.route("**/api/intelligence/recommendations?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ products: [{ id: "recommended-1", slug: "slide-recomendado", name: "Slide recomendado", category: "Slides", description: "Produto disponível", priceInCents: 6990, rating: 4.8, reviews: 20, colors: ["Preto"], sizes: ["39"], image: "/images/products/wave-preto.png", featured: true, stock: 3 }] })
    });
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await page.locator(".header-search-toggle").click();
  await page.locator('input[role="combobox"]:visible').fill("produto inexistente");
  await expect(page.getByText("Nenhum resultado exato")).toBeVisible();
  await expect(page.getByRole("option", { name: /Slide recomendado/ })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
});

test("dados estruturados do produto não geram aviso de hidratação", async ({ page }) => {
  const hydrationWarnings: string[] = [];
  page.on("console", (message) => {
    if (/hydrated|hydration/i.test(message.text())) hydrationWarnings.push(message.text());
  });
  await page.goto("/produto/flip-flop-wave-preto", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "curti Z Flip-Flop Wave Preto" })).toBeVisible();
  expect(hydrationWarnings).toEqual([]);
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

    const dialog = page.getByRole("dialog", { name: "Ajuda curti Z" });
    await expect(async () => {
      await launcher.click();
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox?.y ?? 0).toBeGreaterThanOrEqual(10);
    expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThan(viewport.height);
  }
});

test("consentimento mobile permanece compacto e dentro da viewport", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("curtiz-cookie-consent"));
  for (const width of [320, 390, 430]) {
    await page.context().clearCookies();
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const banner = page.locator(".cookie-consent-card:not(.customizing)");
    await expect(banner).toBeVisible();
    const bounds = await banner.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeLessThanOrEqual(190);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await banner.getByRole("button", { name: "Rejeitar opcionais" }).click();
  }
});

test("carrinho preenchido mantém recomendações e ação fixa sem cobrir conteúdo", async ({
  page
}) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("show-cart-cookie-banner") === "true") {
      localStorage.removeItem("curtiz-cookie-consent");
    } else {
      localStorage.setItem(
        "curtiz-cookie-consent",
        JSON.stringify({ categories: { essential: true } })
      );
    }
    localStorage.setItem(
      "curtiz-cart",
      JSON.stringify([
        {
          productId: "wave-preto",
          slug: "flip-flop-wave-preto",
          category: "Masculino",
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

  for (const width of [320, 375, 390, 430, 768]) {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 844 });
    await page.goto("/carrinho", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Você também pode gostar" })).toBeVisible();
    const itemSelection = page.getByRole("checkbox", {
      name: "Selecionar curti Z Flip-Flop Wave Preto"
    });
    await expect(itemSelection).toBeVisible();
    const selectAll = page.getByRole("checkbox", { name: "Selecionar todos" }).first();
    await selectAll.uncheck();
    await expect(page.getByRole("button", { name: "Remover selecionados" })).toBeDisabled();
    await selectAll.check();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1);
    const mobileSummary = page.locator(".cart-mobile-summary");
    if (width <= 700) {
      await expect(mobileSummary).toBeVisible();
      await expect(page.locator(".cart-summary")).toBeHidden();
      await expect(page.locator(".help-widget")).toBeHidden();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const bounds = await page.evaluate(() => {
        const summary = document.querySelector<HTMLElement>(".cart-mobile-summary");
        const pageShell = document.querySelector<HTMLElement>(".cart-page");
        if (!summary || !pageShell) throw new Error("Carrinho mobile incompleto.");
        return {
          summaryTop: summary.getBoundingClientRect().top,
          pageBottom: pageShell.getBoundingClientRect().bottom,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      expect(bounds.pageBottom).toBeLessThanOrEqual(bounds.summaryTop + 1);
      expect(bounds.overflow).toBeLessThanOrEqual(1);
    } else {
      await expect(mobileSummary).toBeHidden();
      await expect(page.locator(".cart-summary")).toBeVisible();
      await expect(page.locator(".help-widget")).toBeVisible();
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    sessionStorage.setItem("show-cart-cookie-banner", "true");
    localStorage.removeItem("curtiz-cookie-consent");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const cookieBanner = page.locator(".cookie-consent-card:not(.customizing)");
  await expect(cookieBanner).toBeVisible();
  await expect(page.locator(".help-widget")).toBeHidden();
  const positions = await Promise.all([
    cookieBanner.boundingBox(),
    page.locator(".cart-mobile-summary").boundingBox()
  ]);
  expect(positions[0]).not.toBeNull();
  expect(positions[1]).not.toBeNull();
  expect((positions[0]?.y ?? 0) + (positions[0]?.height ?? 0)).toBeLessThanOrEqual(
    positions[1]?.y ?? 0
  );
});

test("404 mantém ações e recomendações acessíveis no mobile", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "curtiz-cookie-consent",
      JSON.stringify({ categories: { essential: true } })
    );
  });

  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const response = await page.goto(`/pagina-inexistente-${width}`, {
      waitUntil: "domcontentloaded"
    });
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Não encontramos esta página." })).toBeVisible();
    const actions = page.locator(".error-actions a");
    await expect(actions).toHaveCount(2);
    for (const action of await actions.all()) {
      const bounds = await action.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator(".error-recommendation-grid .product-card").first()).toBeVisible({
      timeout: 20_000
    });
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      recommendationOverflow:
        (document.querySelector<HTMLElement>(".error-recommendation-grid")?.scrollWidth ?? 0) >
        (document.querySelector<HTMLElement>(".error-recommendation-grid")?.clientWidth ?? 0)
    }));
    expect(layout.content).toBeLessThanOrEqual(layout.viewport);
    expect(layout.recommendationOverflow).toBe(true);
  }
});

test("produto mantém recomendações em grade responsiva sem repetir o item atual", async ({
  page
}) => {
  await page.route("**/api/intelligence/recommendations", async (route) => {
    const products = Array.from({ length: 8 }, (_, index) => ({
      id: `recommended-${index + 1}`,
      slug: `slide-recomendado-${index + 1}`,
      name: `Slide recomendado ${index + 1}`,
      category: "Slides",
      description: "Produto disponível",
      priceInCents: 6990,
      rating: 4.8,
      reviews: 20,
      colors: ["Preto"],
      sizes: ["39"],
      image: "/images/products/wave-preto.png",
      featured: false,
      stock: 3
    }));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ products, nextCursor: null })
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/produto/flip-flop-wave-preto", { waitUntil: "domcontentloaded" });
  const shelf = page.locator(".product-recommendations");
  await expect(shelf.getByRole("heading", { name: "Você Também Pode Gostar" })).toBeVisible();
  await expect(shelf.locator(".product-card")).toHaveCount(8);
  await expect(shelf.locator('a[href="/produto/flip-flop-wave-preto"]')).toHaveCount(0);
  await expect(page.locator(".product-summary").getByText("Vendido por")).toHaveCount(0);
  await expect(page.locator(".product-summary").getByText("Compra segura")).toHaveCount(0);

  const selectedColor = page.locator(".product-summary .color-swatch.selected").first();
  if ((await selectedColor.count()) > 0) {
    expect(
      await selectedColor.evaluate((element) => getComputedStyle(element, "::after").content)
    ).toBe("none");
  }

  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width <= 430 ? 844 : 1000 });
    const columns = await shelf.locator(".product-grid").evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" ").length
    );
    expect(columns).toBe(width <= 700 ? 2 : width <= 900 ? 3 : 4);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1);
  }
});
