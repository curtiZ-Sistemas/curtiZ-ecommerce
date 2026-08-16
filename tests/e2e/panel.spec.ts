import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, email: string) {
  const destinationByAccount = {
    "admin.demo@curtiz.local": "administracao",
    "operacional.demo@curtiz.local": "operacional",
    "gerencia.demo@curtiz.local": "gerencia",
    "tecnico.demo@curtiz.local": "tecnico"
  } as const;
  const destination = destinationByAccount[email as keyof typeof destinationByAccount];
  if (!destination) throw new Error(`Conta interna de teste não mapeada: ${email}`);
  const response = await page.request.post("http://localhost:3000/api/auth/login", {
    data: { email, password: "1234567890" }
  });
  if (!response.ok()) throw new Error(`Login demo falhou com HTTP ${response.status()}`);
  await page.goto(`http://localhost:3001/${destination}`, { waitUntil: "commit" });
  await expect(page.locator('main[aria-label="Carregando painel"]')).toHaveCount(0, {
    timeout: 60_000
  });
  await expect(page.locator(".panel-layout")).toBeAttached({ timeout: 60_000 });
}

for (const account of [
  { email: "admin.demo@curtiz.local", route: "administracao" },
  { email: "operacional.demo@curtiz.local", route: "operacional" },
  { email: "gerencia.demo@curtiz.local", route: "gerencia" },
  { email: "tecnico.demo@curtiz.local", route: "tecnico" }
] as const) {
  test(`abre a rota inicial de ${account.route} sem Server Component crash`, async ({ page }) => {
    test.setTimeout(90_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /content security policy|hydration|react/i.test(message.text())) {
        consoleErrors.push(message.text());
      }
    });
    await loginAs(page, account.email);
    await expect(page).toHaveURL(`http://localhost:3001/${account.route}`);
    await expect(page.getByText("Falha ao carregar")).toHaveCount(0);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator(".panel-layout")).toHaveAttribute("data-panel-role", account.route);
    await expect(page.locator(".panel-layout")).toHaveCSS("background-color", "rgb(238, 238, 238)");
    await expect(page.locator(".sidebar")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator(".side-nav a.active")).toHaveCSS("background-color", "rgb(249, 227, 224)");
    expect(consoleErrors).toEqual([]);
  });
}

test("painel técnico não finge integrações conectadas", async ({ page }) => {
  await loginAs(page, "tecnico.demo@curtiz.local");
  await page.goto("/tecnico/integracoes");
  await expect(page.getByRole("heading", { name: /Integra/ })).toBeVisible();
  await expect(page.getByText("Não configurado").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Aguardando credenciais")).toBeVisible({ timeout: 20_000 });
});

test("novo suporte aparece na fila administrativa", async ({ page }) => {
  test.setTimeout(90_000);
  const subject = `Pedido sem atualização ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("http://localhost:3000/login");
  await page.getByLabel("E-mail de acesso").fill("cliente.demo@curtiz.local");
  await page.getByPlaceholder("Digite sua senha").fill("1234567890");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await page.waitForURL("http://localhost:3000/minha-conta", { timeout: 30_000 });
  await page.goto("http://localhost:3000/minha-conta/atendimento?new=1");
  await page.getByLabel("Assunto").fill(subject);
  await page.getByLabel("Mensagem inicial").fill("Meu pedido ainda não recebeu uma atualização logística.");
  await page.getByRole("button", { name: /Enviar para a equipe/i }).click();
  await expect(page.getByText(/Seu chamado foi enviado e aguarda atendimento/i).first()).toBeVisible();

  await loginAs(page, "admin.demo@curtiz.local");
  await page.goto("/administracao/atendimentos");
  await expect(page.getByText("Fila de atendimentos")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(subject) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(subject) }).click();
  await page.getByRole("button", { name: "Assumir" }).click();
  await expect(page.getByText(/Atendimento assumido com sucesso/i)).toBeVisible();
  await page.getByLabel("Responder").fill("A equipe está verificando o rastreio com a transportadora.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText(/Resposta enviada ao cliente/i)).toBeVisible();
});

test("logout do painel encerra a sessão e volta ao login", async ({ page }) => {
  test.setTimeout(90_000);
  await loginAs(page, "admin.demo@curtiz.local");
  const logoutResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/logout") && response.request().method() === "POST",
    { timeout: 20_000 }
  );
  await page.getByRole("button", { name: "Sair do painel" }).click();
  const response = await logoutResponse;
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL("http://localhost:3000/login", { timeout: 20_000 });
});

test("preserva o scroll da sidebar ao navegar para um item no fim do menu", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 650 });
  await loginAs(page, "admin.demo@curtiz.local");
  const navigation = page.locator(".side-nav");
  await expect(page.getByRole("link", { name: "Configurações administrativas" })).toBeVisible();
  await navigation.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await navigation.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  await page.getByRole("link", { name: "Configurações administrativas" }).click();
  await page.waitForURL("**/administracao/configuracoes");
  const restored = await page.locator(".side-nav").evaluate((element) => element.scrollTop);
  expect(restored).toBeGreaterThan(100);
  await expect(page.getByRole("link", { name: "Configurações administrativas" })).toHaveClass(/active/);
});

const panelAccounts = [
  { email: "admin.demo@curtiz.local", role: "administracao", expectedRoutes: 30 },
  { email: "operacional.demo@curtiz.local", role: "operacional", expectedRoutes: 21 },
  { email: "gerencia.demo@curtiz.local", role: "gerencia", expectedRoutes: 29 },
  { email: "tecnico.demo@curtiz.local", role: "tecnico", expectedRoutes: 24 }
] as const;

for (const account of panelAccounts) {
  test(`abre e classifica todas as rotas reais de ${account.role}`, async ({ page }) => {
    test.setTimeout(8 * 60_000);
    const failures = new Set<string>();
    let currentRoute = `/${account.role}`;

    page.on("pageerror", (error) => failures.add(`${currentRoute}: pageerror ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && /content security policy|hydration|react/i.test(message.text())) {
        failures.add(`${currentRoute}: console ${message.text().replace(/nonce-[^']+/gu, "nonce-redacted")}`);
      }
    });
    page.on("response", (response) => {
      if (response.url().startsWith("http://localhost:3001") && response.status() >= 500) {
        failures.add(`${currentRoute}: HTTP ${response.status()} em ${new URL(response.url()).pathname}`);
      }
    });

    await loginAs(page, account.email);
    const entries = await page.locator(".side-nav a[href]").evaluateAll((links) =>
      links.map((link) => ({
        href: (link as HTMLAnchorElement).href,
        label: link.textContent?.trim() ?? ""
      }))
    );

    expect(entries, `quantidade de rotas de ${account.role}`).toHaveLength(account.expectedRoutes);
    expect(new Set(entries.map((entry) => entry.href)).size).toBe(entries.length);

    for (const entry of entries) {
      currentRoute = new URL(entry.href).pathname;
      const response = await page.goto(entry.href, { waitUntil: "commit", timeout: 60_000 });
      expect(response?.status(), currentRoute).toBeLessThan(500);
      await expect(page.locator("main.panel-content"), currentRoute).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(".topbar-context strong"), currentRoute).toHaveText(
        currentRoute === `/${account.role}` ? "Visão geral" : entry.label,
        { timeout: 60_000 }
      );
      await expect(page.locator("main.panel-content h1").first(), `${currentRoute} sem título principal`).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/Área .* não encontrada/i), currentRoute).toHaveCount(0);

      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth
      }));
      expect(Math.max(overflow.document, overflow.body), `${currentRoute} com overflow`).toBeLessThanOrEqual(1);
    }
    expect([...failures]).toEqual([]);
  });
}

test("mantém rotas críticas utilizáveis nos viewports exigidos", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const viewports = [320, 360, 390, 430, 768, 1024, 1280];
  const criticalRoutes = [
    { email: "admin.demo@curtiz.local", path: "/administracao/produtos" },
    { email: "operacional.demo@curtiz.local", path: "/operacional/pedidos" },
    { email: "gerencia.demo@curtiz.local", path: "/gerencia" },
    { email: "tecnico.demo@curtiz.local", path: "/tecnico/integracoes" }
  ] as const;

  for (const route of criticalRoutes) {
    await loginAs(page, route.email);
    for (const width of viewports) {
      await page.setViewportSize({ width, height: width <= 430 ? 780 : 900 });
      const response = await page.goto(route.path, {
        waitUntil: "commit",
        timeout: 60_000
      });
      expect(response?.status(), `${route.path} em ${width}px`).toBeLessThan(500);
      await expect(page.locator("main.panel-content"), `${route.path} em ${width}px`).toBeVisible({ timeout: 60_000 });
      const overflow = await page.evaluate(() =>
        Math.max(
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
          document.body.scrollWidth - document.body.clientWidth
        )
      );
      expect(overflow, `${route.path} em ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});

test("abre, edita e salva produtos sem derrubar o painel", async ({ page }) => {
  test.setTimeout(120_000);
  const failures: string[] = [];
  const categoryId = "10000000-0000-0000-0000-000000000001";
  let savedName = "Produto com múltiplas variações";
  let savedPayload: Record<string, unknown> | null = null;
  let missingProductId = "";
  const openedProductIds: string[] = [];
  const products = [
    {
      id: "20000000-0000-0000-0000-000000000001",
      name: savedName,
      slug: "produto-multiplas-variacoes",
      status: "active",
      statusReason: "",
      priceInCents: 12990,
      compareAtPriceInCents: null,
      categoryId,
      modelId: "",
      collectionId: "",
      shortDescription: "Descrição curta do produto",
      description: "Descrição detalhada do produto",
      costInCents: 5000,
      featured: false,
      weightGrams: 400,
      heightCm: 10,
      widthCm: 20,
      lengthCm: 30,
      seoTitle: "",
      seoDescription: "",
      images: [{
        id: "40000000-0000-0000-0000-000000000001",
        path: "/images/products/wave-preto.png",
        url: "http://localhost:3000/images/products/wave-preto.png",
        alt: "Produto com variações",
        primary: true,
        sortOrder: 0
      }],
      stock: 7,
      variants: [
        { id: "30000000-0000-0000-0000-000000000001", sku: "MULTI-PRETO-39", color: "Preto", colorHex: "#000000", size: "39", active: true, available: 4, reserved: 1, sellable: 4, priceInCents: null, costInCents: null },
        { id: "30000000-0000-0000-0000-000000000002", sku: "MULTI-PRETO-40", color: "Preto", colorHex: "#000000", size: "40", active: true, available: 3, reserved: 0, sellable: 3, priceInCents: null, costInCents: null }
      ]
    },
    {
      id: "20000000-0000-0000-0000-000000000002",
      name: "Produto sem imagem e sem variação",
      slug: "produto-sem-imagem-variacao",
      status: "draft",
      statusReason: "",
      priceInCents: 8990,
      compareAtPriceInCents: null,
      categoryId,
      modelId: "",
      collectionId: "",
      shortDescription: "Produto ainda em preparação",
      description: "Produto sem imagem e sem variação configurada",
      costInCents: 3000,
      featured: false,
      weightGrams: 350,
      heightCm: 8,
      widthCm: 18,
      lengthCm: 28,
      seoTitle: "",
      seoDescription: "",
      images: [],
      stock: 0,
      variants: []
    },
    {
      id: "20000000-0000-0000-0000-000000000003",
      name: "Produto arquivado sem estoque",
      slug: "produto-arquivado-sem-estoque",
      status: "archived",
      statusReason: "Produto descontinuado",
      priceInCents: 9990,
      compareAtPriceInCents: null,
      categoryId,
      modelId: "",
      collectionId: "",
      shortDescription: "Produto arquivado",
      description: "Produto arquivado sem saldo disponível",
      costInCents: 4000,
      featured: false,
      weightGrams: 380,
      heightCm: 9,
      widthCm: 19,
      lengthCm: 29,
      seoTitle: "",
      seoDescription: "",
      images: [],
      stock: 0,
      variants: [{ id: "30000000-0000-0000-0000-000000000003", sku: "ARQ-40", color: "Areia", colorHex: "#d6c3a5", size: "40", active: false, available: 0, reserved: 0, sellable: 0, priceInCents: null, costInCents: null }]
    }
  ];
  const createdProducts: Array<(typeof products)[number]> = [];

  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.url().startsWith("http://localhost:3001") && response.status() >= 500) {
      failures.push(`HTTP ${response.status()} em ${new URL(response.url()).pathname}`);
    }
  });
  await page.route("**/api/catalog/products?*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    products[0].name = savedName;
    const productId = new URL(route.request().url()).searchParams.get("productId");
    const availableProducts = [...products, ...createdProducts];
    const selectedProducts = productId
      ? availableProducts.filter((product) => product.id === productId && product.id !== missingProductId)
      : availableProducts;
    if (productId) openedProductIds.push(productId);
    await route.fulfill({
      status: productId && selectedProducts.length === 0 ? 404 : 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: selectedProducts,
        total: selectedProducts.length,
        ...(productId && selectedProducts.length === 0 ? { message: "Produto não encontrado." } : {}),
        page: 1,
        pageSize: 20,
        categories: [{ id: categoryId, name: "Sandálias" }],
        models: [],
        collections: [],
        capabilities: { create: true, update: true, adjustStock: true, archive: true }
      })
    });
  });
  await page.route("**/api/catalog/products", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    savedPayload = route.request().postDataJSON() as Record<string, unknown>;
    const action = String(savedPayload.action);
    let message = "Alteração concluída.";
    if (action === "save" && savedPayload.productId) {
      savedName = String(savedPayload.name);
      message = "Produto atualizado.";
    } else if (action === "save") {
      createdProducts.push({
        ...products[1]!,
        id: "20000000-0000-0000-0000-000000000004",
        name: String(savedPayload.name),
        slug: String(savedPayload.slug)
      });
      message = "Produto criado como configurado.";
    } else if (action === "duplicate") {
      createdProducts.push({
        ...products[0]!,
        id: "20000000-0000-0000-0000-000000000005",
        name: String(savedPayload.name),
        slug: String(savedPayload.slug),
        status: "draft",
        images: [],
        stock: 0,
        variants: products[0]!.variants.map((variant, index) => ({
          ...variant,
          id: `30000000-0000-0000-0000-00000000001${index}`,
          available: 0,
          reserved: 0,
          sellable: 0
        }))
      });
      message = "Produto e variações duplicados como rascunho.";
    } else if (action === "status") {
      products[0]!.status = String(savedPayload.status);
      message = "Status do produto atualizado.";
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ productId: products[0].id, message })
    });
  });

  await loginAs(page, "admin.demo@curtiz.local");
  await page.goto("/administracao/produtos");
  await expect(page.getByText(savedName)).toBeVisible({ timeout: 20_000 });

  for (const product of products) {
    const row = page.locator("article.managed-product").filter({ hasText: product.name });
    await row.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Produto" })).toBeVisible();
    await expect(page).toHaveURL("http://localhost:3001/administracao/produtos");
    await expect(page.getByText("Falha ao carregar")).toHaveCount(0);
    await page.getByRole("button", { name: "Fechar" }).click();
  }
  expect(openedProductIds).toEqual(products.map((product) => product.id));

  const removedProduct = products[1]!;
  missingProductId = removedProduct.id;
  const removedRow = page.locator("article.managed-product").filter({ hasText: removedProduct.name });
  await removedRow.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByText("Produto não encontrado.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Produto" })).toHaveCount(0);
  await expect(page.getByText("Falha ao carregar")).toHaveCount(0);

  const firstRow = page.locator("article.managed-product").filter({ hasText: savedName });
  await firstRow.getByRole("button", { name: "Editar", exact: true }).click();
  const updatedName = `${savedName} atualizado`;
  await page.getByRole("dialog", { name: "Produto" }).getByLabel("Nome *").fill(updatedName);
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto atualizado.")).toBeVisible();
  await expect(page.getByText(updatedName)).toBeVisible();
  expect(savedPayload).toMatchObject({
    action: "save",
    productId: products[0].id,
    name: updatedName,
    variants: expect.arrayContaining([
      expect.objectContaining({ sku: "MULTI-PRETO-39", stock: 4 }),
      expect.objectContaining({ sku: "MULTI-PRETO-40", stock: 3 })
    ])
  });

  const updatedRow = page.locator("article.managed-product").filter({ hasText: updatedName });
  page.once("dialog", (dialog) => void dialog.accept("Pausa comercial planejada"));
  await updatedRow.locator("details.product-action-menu > summary").click();
  await updatedRow.getByRole("button", { name: "Desativar" }).click();
  await expect(page.getByText("Status do produto atualizado.")).toBeVisible();
  await expect(page.locator("article.managed-product").filter({ hasText: updatedName }).getByText("Inativo")).toBeVisible();

  const inactiveRow = page.locator("article.managed-product").filter({ hasText: updatedName });
  await inactiveRow.locator("details.product-action-menu > summary").click();
  await inactiveRow.getByRole("button", { name: "Duplicar" }).click();
  const duplicateName = `${updatedName} — cópia E2E`;
  await page.getByRole("dialog", { name: "Duplicar produto" }).getByLabel("Novo nome").fill(duplicateName);
  await page.getByRole("dialog", { name: "Duplicar produto" }).getByLabel("Novo slug").fill("produto-copia-e2e");
  await page.getByRole("dialog", { name: "Duplicar produto" }).getByRole("button", { name: "Duplicar" }).click();
  await expect(page.getByText(duplicateName)).toBeVisible();

  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  const createDialog = page.getByRole("dialog", { name: "Produto" });
  await createDialog.getByLabel("Nome *").fill("Produto criado no fluxo E2E");
  await createDialog.getByLabel("Slug *").fill("produto-criado-fluxo-e2e");
  await createDialog.getByLabel("Categoria *").selectOption(categoryId);
  await createDialog.getByLabel("Preço (R$) *").fill("79.90");
  await createDialog.getByLabel("Custo (R$) *").fill("30.00");
  await createDialog.getByLabel("Peso (g) *").fill("300");
  await createDialog.getByLabel("Altura (cm) *").fill("8");
  await createDialog.getByLabel("Largura (cm) *").fill("18");
  await createDialog.getByLabel("Comprimento (cm) *").fill("27");
  await createDialog.getByLabel("Descrição curta *").fill("Produto criado pelo fluxo completo");
  await createDialog.getByLabel("Descrição detalhada *").fill("Cadastro validado sem dados reais de produção.");
  await createDialog.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto criado no fluxo E2E")).toBeVisible();

  for (const route of ["variacoes", "midias", "estoque"]) {
    await page.goto(`/administracao/${route}`);
    await expect(page.getByRole("heading", { name: updatedName, exact: true })).toBeVisible();
    await expect(page.getByText("Falha ao carregar")).toHaveCount(0);
  }
  expect(failures).toEqual([]);
});
