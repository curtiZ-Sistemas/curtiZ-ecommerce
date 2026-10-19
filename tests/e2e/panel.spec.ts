import { expect, test, type Page } from "@playwright/test";
import { loginDemoAccount } from "./demo-auth";

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 412, height: 915 }
]) {
  test(`autentica conta operacional pela loja e abre o painel em ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
    const email = page.locator('input[name="email"]:visible');
    await email.fill("operacional.demo@curtiz.local");
    await page.locator('input[name="password"]:visible').fill("1234567890");
    await expect(email).toHaveValue("operacional.demo@curtiz.local");
    await page.getByLabel(/Li e aceito os Termos de Uso/).check();
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    await expect(page).toHaveURL("http://localhost:3001/operacional", { timeout: 60_000 });
    await expect(page.locator(".panel-layout")).toHaveAttribute("data-panel-role", "operacional");
    await expect(page.locator("#panel-content").getByRole("heading", { name: "Visão geral", level: 1 })).toBeVisible({ timeout: 60_000 });
  });
}

async function loginAs(page: Page, email: string) {
  const destinationByAccount = {
    "admin.demo@curtiz.local": "administracao",
    "operacional.demo@curtiz.local": "operacional",
    "gerencia.demo@curtiz.local": "gerencia",
    "tecnico.demo@curtiz.local": "tecnico"
  } as const;
  const destination = destinationByAccount[email as keyof typeof destinationByAccount];
  if (!destination) throw new Error(`Conta interna de teste não mapeada: ${email}`);
  await loginDemoAccount(page, email);
  await page.goto(`http://localhost:3001/${destination}`, { waitUntil: "commit" });
  await expect(page.locator('main[aria-label="Carregando painel"]')).toHaveCount(0, {
    timeout: 60_000
  });
  await expect(page.locator(".panel-layout")).toBeAttached({ timeout: 60_000 });
}

test("funcionário usa a conta de cliente e volta ao painel com a mesma sessão", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAs(page, "operacional.demo@curtiz.local");
  await page.getByRole("link", { name: "Minha conta de cliente" }).click();
  await expect(page).toHaveURL("http://localhost:3000/minha-conta");
  await expect(page.getByRole("heading", { name: "Entre na sua conta curti Z" })).toHaveCount(0);
  await page.getByRole("link", { name: "Acessar painéis", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3001/operacional", { timeout: 60_000 });
  await expect(page.locator(".panel-layout")).toHaveAttribute("data-panel-role", "operacional");
});

test("cliente comum não recebe entrada nem permissão para painéis internos", async ({ page }) => {
  await loginDemoAccount(page, "cliente.demo@curtiz.local");
  await page.goto("http://localhost:3000/minha-conta");
  await expect(page.getByRole("link", { name: "Acessar painéis", exact: true })).toHaveCount(0);
  await page.goto("http://localhost:3001/operacional");
  await expect(page).toHaveURL(/localhost:3000\/login/);
});

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
      if (
        message.type() === "error" &&
        /content security policy|hydration|react/i.test(message.text())
      ) {
        consoleErrors.push(message.text());
      }
    });
    await loginAs(page, account.email);
    await expect(page).toHaveURL(`http://localhost:3001/${account.route}`);
    await expect(page.getByText("Falha ao carregar")).toHaveCount(0);
    await expect(page.locator("#panel-content")).toBeVisible();
    await expect(page.locator(".panel-layout")).toHaveAttribute("data-panel-role", account.route);
    await expect(page.locator(".panel-layout")).toHaveCSS("background-color", "rgb(245, 243, 240)");
    await expect(page.locator(".sidebar")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator(".side-nav a.active")).toHaveCSS(
      "background-color",
      "rgb(255, 237, 232)"
    );
    const switchLink = page.locator(".sidebar-switch-link");
    if (await switchLink.count()) {
      const switchBox = await switchLink.boundingBox();
      const supportBox = await page.locator(".support-card").boundingBox();
      expect(switchBox).not.toBeNull();
      expect(supportBox).not.toBeNull();
      const gap = supportBox!.y - (switchBox!.y + switchBox!.height);
      expect(gap).toBeCloseTo(0, 1);
    }
    expect(consoleErrors).toEqual([]);
  });
}

test("painel técnico não finge integrações conectadas", async ({ page }) => {
  await loginAs(page, "tecnico.demo@curtiz.local");
  await page.goto("/tecnico/integracoes");
  await expect(page.getByRole("heading", { name: "Integrações", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bling", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Melhor Envio", exact: true })).toBeVisible();
  await expect(page.getByText("Não configurado").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Aguardando credenciais")).toBeVisible({ timeout: 20_000 });
});

test("painel técnico separa os metadados de deploy da loja e do painel", async ({ page }) => {
  await loginAs(page, "tecnico.demo@curtiz.local");
  await page.goto("/tecnico/deploys");
  const deploys = page.getByRole("region", { name: "Runtime, deploy e manutenção" }).locator(".technical-deploys");
  await expect(deploys.getByRole("heading", { name: "Loja" })).toBeVisible();
  await expect(deploys.getByRole("heading", { name: "Painel" })).toBeVisible();
  await expect(deploys.getByText("Commit")).toHaveCount(2);
  await expect(deploys).not.toContainText(/token|secret|senha/i);
});

test("busca global abre com teclado e mantém resultados protegidos por função", async ({
  page
}) => {
  await loginAs(page, "admin.demo@curtiz.local");
  const searchButton = page.locator(".topbar-search > button");
  await expect(async () => {
    await searchButton.click();
    await expect(searchButton).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const search = page.getByRole("textbox", { name: "Buscar no painel", exact: true });
  await expect(search).toBeFocused();
  await search.fill("produto");
  await expect(page.locator("#panel-search-results")).toBeVisible();
  await expect(page.getByText("Nenhum resultado encontrado.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(searchButton).toHaveAttribute("aria-expanded", "false");
  await expect(searchButton).toBeFocused();
});

test("novo suporte aparece na fila administrativa", async ({ page }) => {
  test.setTimeout(90_000);
  const subject = `Pedido sem atualização ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("http://localhost:3000/login");
  await page.getByLabel("E-mail de acesso").fill("cliente.demo@curtiz.local");
  await page.getByPlaceholder("Digite sua senha").fill("1234567890");
  await page.getByLabel(/Li e aceito os Termos de Uso/).check();
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("http://localhost:3000/minha-conta", { timeout: 30_000 });
  await page.goto("http://localhost:3000/minha-conta/atendimento?new=1");
  await page.getByLabel("Assunto").fill(subject);
  await page
    .getByLabel("Mensagem inicial")
    .fill("Meu pedido ainda não recebeu uma atualização logística.");
  await page.getByRole("button", { name: /Enviar para a equipe/i }).click();
  await expect(
    page.getByText(/Seu chamado foi enviado e aguarda atendimento/i).first()
  ).toBeVisible();

  await loginAs(page, "admin.demo@curtiz.local");
  await page.goto("/administracao/atendimentos");
  await expect(page.getByText("Fila de atendimentos")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(subject) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(subject) }).click();
  await page.getByRole("button", { name: "Assumir" }).click();
  await expect(page.getByText(/Atendimento assumido com sucesso/i)).toBeVisible();
  await page
    .getByLabel("Responder")
    .fill("A equipe está verificando o rastreio com a transportadora.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText(/Resposta enviada ao cliente/i)).toBeVisible();
});

test("logout do painel encerra a sessão e volta ao login", async ({ page }) => {
  test.setTimeout(90_000);
  await loginAs(page, "admin.demo@curtiz.local");
  const logoutResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/logout") && response.request().method() === "POST",
    { timeout: 20_000 }
  );
  await page.getByRole("button", { name: "Sair do painel" }).click();
  const response = await logoutResponse;
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL("http://localhost:3000/login", { timeout: 20_000 });
});

test("remove configurações técnicas da administração e redireciona o bookmark antigo", async ({
  page
}) => {
  await loginAs(page, "admin.demo@curtiz.local");
  await expect(page.getByRole("link", { name: "Configurações administrativas" })).toHaveCount(0);
  await page.goto("/administracao/configuracoes");
  await expect(page).toHaveURL("http://localhost:3001/administracao");
  for (const route of ["modelos", "variacoes", "midias", "estoque"]) {
    await page.goto(`/administracao/${route}`);
    await expect(page).toHaveURL("http://localhost:3001/administracao/produtos");
  }
});

const panelAccounts = [
  { email: "admin.demo@curtiz.local", role: "administracao", expectedRoutes: 26 },
  { email: "operacional.demo@curtiz.local", role: "operacional", expectedRoutes: 21 },
  { email: "gerencia.demo@curtiz.local", role: "gerencia", expectedRoutes: 32 },
  { email: "tecnico.demo@curtiz.local", role: "tecnico", expectedRoutes: 24 }
] as const;

for (const account of panelAccounts) {
  test(`abre e classifica todas as rotas reais de ${account.role}`, async ({ page }) => {
    test.setTimeout(8 * 60_000);
    const failures = new Set<string>();
    let currentRoute = `/${account.role}`;

    page.on("pageerror", (error) => failures.add(`${currentRoute}: pageerror ${error.message}`));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /content security policy|hydration|react/i.test(message.text())
      ) {
        failures.add(
          `${currentRoute}: console ${message.text().replace(/nonce-[^']+/gu, "nonce-redacted")}`
        );
      }
    });
    page.on("response", (response) => {
      if (response.url().startsWith("http://localhost:3001") && response.status() >= 500) {
        failures.add(
          `${currentRoute}: HTTP ${response.status()} em ${new URL(response.url()).pathname}`
        );
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
      await expect(page.locator("main.panel-content"), currentRoute).toBeVisible({
        timeout: 60_000
      });
      await expect(page.locator(".topbar-context strong"), currentRoute).toHaveText(
        currentRoute === `/${account.role}` ? "Visão geral" : entry.label,
        { timeout: 60_000 }
      );
      await expect(
        page.locator("main.panel-content h1").first(),
        `${currentRoute} sem título principal`
      ).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/Área .* não encontrada/i), currentRoute).toHaveCount(0);

      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth
      }));
      expect(
        Math.max(overflow.document, overflow.body),
        `${currentRoute} com overflow`
      ).toBeLessThanOrEqual(1);
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
      await expect(page.locator("main.panel-content"), `${route.path} em ${width}px`).toBeVisible({
        timeout: 60_000
      });
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
  // Catalog/draft fixtures exercise the editor UI; persistence is validated separately.
  const failures: string[] = [];
  const categoryId = "10000000-0000-4000-8000-000000000001";
  let savedName = "Produto com múltiplas variações";
  let savedPayload: Record<string, unknown> | null = null;
  let missingProductId = "";
  const openedProductIds: string[] = [];
  const products = [
    {
      id: "20000000-0000-4000-8000-000000000001",
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
      canDelete: false,
      images: [
        {
          id: "40000000-0000-4000-8000-000000000001",
          path: "/images/products/wave-preto.png",
          url: "http://localhost:3000/images/products/wave-preto.png",
          alt: "Produto com variações",
          primary: true,
          sortOrder: 0
        }
      ],
      stock: 7,
      variants: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          sku: "MULTI-PRETO-39",
          color: "Preto",
          colorHex: "#000000",
          size: "39",
          active: true,
          available: 4,
          reserved: 1,
          sellable: 4,
          priceInCents: null,
          costInCents: null
        },
        {
          id: "30000000-0000-4000-8000-000000000002",
          sku: "MULTI-PRETO-40",
          color: "Preto",
          colorHex: "#000000",
          size: "40",
          active: true,
          available: 3,
          reserved: 0,
          sellable: 3,
          priceInCents: null,
          costInCents: null
        }
      ]
    },
    {
      id: "20000000-0000-4000-8000-000000000002",
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
      canDelete: false,
      images: [],
      stock: 0,
      variants: []
    },
    {
      id: "20000000-0000-4000-8000-000000000003",
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
      canDelete: true,
      images: [],
      stock: 0,
      variants: [
        {
          id: "30000000-0000-4000-8000-000000000003",
          sku: "ARQ-40",
          color: "Areia",
          colorHex: "#d6c3a5",
          size: "40",
          active: false,
          available: 0,
          reserved: 0,
          sellable: 0,
          priceInCents: null,
          costInCents: null
        }
      ]
    }
  ];
  const createdProducts: Array<(typeof products)[number]> = [];
  let productDraft: Record<string, unknown> | null = null;
  let draftWrites = 0;
  let catalogPatches = 0;

  await page.route("**/api/catalog/product-draft", async (route) => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ json: { ok: true, draft: productDraft } });
    if (method === "PUT") {
      draftWrites += 1;
      productDraft = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: { ok: true, savedAt: productDraft.savedAt } });
    }
    if (method === "DELETE") {
      productDraft = null;
      return route.fulfill({ json: { ok: true } });
    }
    return route.continue();
  });

  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.url().startsWith("http://localhost:3001") && response.status() >= 500) {
      failures.push(`HTTP ${response.status()} em ${new URL(response.url()).pathname}`);
    }
  });
  await page.route("**/api/catalog/products?*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    products[0]!.name = savedName;
    const productId = new URL(route.request().url()).searchParams.get("productId");
    const availableProducts = [...products, ...createdProducts];
    const selectedProducts = productId
      ? availableProducts.filter(
          (product) => product.id === productId && product.id !== missingProductId
        )
      : availableProducts;
    if (productId) openedProductIds.push(productId);
    await route.fulfill({
      status: productId && selectedProducts.length === 0 ? 404 : 200,
      contentType: "application/json",
      body: JSON.stringify({
        products: selectedProducts,
        total: selectedProducts.length,
        ...(productId && selectedProducts.length === 0
          ? { message: "Produto não encontrado." }
          : {}),
        page: 1,
        pageSize: 20,
        categories: [{ id: categoryId, name: "Sandálias" }],
        models: [],
        collections: [],
        capabilities: { create: true, update: true, adjustStock: true, archive: true, delete: true }
      })
    });
  });
  await page.route("**/api/catalog/products", async (route) => {
    if (route.request().method() === "DELETE") {
      const payload = route.request().postDataJSON() as { productId: string };
      const index = products.findIndex((product) => product.id === payload.productId);
      if (index >= 0) products.splice(index, 1);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "Produto excluído permanentemente." })
      });
      return;
    }
    if (route.request().method() !== "PATCH") return route.continue();
    catalogPatches += 1;
    savedPayload = route.request().postDataJSON() as Record<string, unknown>;
    const action = String(savedPayload.action);
    let responseProductId = products[0]!.id;
    let message = "Alteração concluída.";
    if (action === "save" && savedPayload.productId) {
      savedName = String(savedPayload.name);
      message = "Produto atualizado.";
    } else if (action === "save") {
      responseProductId = "20000000-0000-4000-8000-000000000004";
      createdProducts.push({
        ...products[1]!,
        id: responseProductId,
        name: String(savedPayload.name),
        slug: String(savedPayload.slug),
        status: String(savedPayload.status),
        priceInCents: Number(savedPayload.priceInCents),
        stock: 5,
        images: [],
        variants: [{ ...products[0]!.variants[0]!,
          id: "30000000-0000-4000-8000-000000000004", sku: "E2E-NEW",
          color: "Padrão", colorHex: "", size: "Único", active: true, available: 5, reserved: 0, sellable: 5 }]
      });
      // New-product save clears the server draft atomically in the same RPC.
      productDraft = null;
      message = "Produto criado como configurado.";
    } else if (action === "duplicate") {
      createdProducts.push({
        ...products[0]!,
        id: "20000000-0000-4000-8000-000000000005",
        name: String(savedPayload.name),
        slug: String(savedPayload.slug),
        status: "draft",
        images: [],
        stock: 0,
        variants: products[0]!.variants.map((variant, index) => ({
          ...variant,
          id: `30000000-0000-4000-8000-00000000001${index}`,
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
      body: JSON.stringify({ productId: responseProductId, message })
    });
  });

  await loginAs(page, "admin.demo@curtiz.local");
  await page.goto("/administracao/produtos");
  await expect(page.getByText(savedName)).toBeVisible({ timeout: 20_000 });

  for (const product of products) {
    const row = page.locator("article.managed-product").filter({ hasText: product.name });
    await row.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(page.locator(".panel-drawer")).toBeVisible();
    if (product === products[0]) {
      for (const width of [320, 360, 375, 390, 412, 430, 1024, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: width <= 430 ? 780 : 900 });
        const bounds = await page.locator(".panel-drawer").boundingBox();
        expect(bounds?.x ?? -1, `drawer fora da viewport em ${width}px`).toBeGreaterThanOrEqual(0);
        expect(
          (bounds?.x ?? 0) + (bounds?.width ?? width),
          `drawer largo demais em ${width}px`
        ).toBeLessThanOrEqual(width + 1);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `overflow do editor em ${width}px`).toBeLessThanOrEqual(1);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await expect(page).toHaveURL("http://localhost:3001/administracao/produtos");
    await expect(page.getByText("Falha ao carregar")).toHaveCount(0);
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
  }
  expect(openedProductIds).toEqual(products.map((product) => product.id));

  const deletableProduct = products[2]!;
  const deletableRow = page
    .locator("article.managed-product")
    .filter({ hasText: deletableProduct.name });
  await deletableRow.locator("details.product-action-menu > summary").click();
  await deletableRow.getByRole("button", { name: "Excluir permanentemente" }).click();
  const deleteDialog = page.getByRole("alertdialog", { name: "Excluir definitivamente?" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Excluir definitivamente", exact: true }).click();
  await expect(page.getByText("Produto excluído permanentemente.")).toBeVisible();
  await expect(deletableRow).toHaveCount(0);

  const removedProduct = products[1]!;
  missingProductId = removedProduct.id;
  const removedRow = page
    .locator("article.managed-product")
    .filter({ hasText: removedProduct.name });
  await removedRow.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByText("Produto não encontrado.")).toBeVisible();
  await expect(page.locator(".panel-drawer")).toHaveCount(0);
  await expect(page.getByText("Falha ao carregar")).toHaveCount(0);

  const firstRow = page.locator("article.managed-product").filter({ hasText: savedName });
  await firstRow.getByRole("button", { name: "Editar", exact: true }).click();
  const updatedName = `${savedName} atualizado`;
  const editDialog = page.locator(".panel-drawer");
  await expect(editDialog.getByRole("group", { name: "Categorias", exact: true })
    .getByRole("checkbox", { name: "Sandálias", exact: true })).toBeChecked();
  await expect(editDialog.getByRole("button", { name: "Sandálias como categoria principal" }))
    .toHaveAttribute("aria-pressed", "true");
  await editDialog.getByLabel("Nome *").fill(updatedName);
  await expect(editDialog.getByLabel("Nome *")).toHaveValue(updatedName);
  expect(await editDialog.locator("form").evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(true);
  await page.keyboard.press("Control+s");
  await expect(page.getByText("Produto atualizado com sucesso.")).toBeVisible({ timeout: 15_000 });
  await expect(editDialog).toHaveCount(0);
  await expect(page.locator("article.managed-product")
    .getByRole("heading", { name: updatedName, exact: true })).toBeVisible();
  expect(savedPayload).toMatchObject({
    action: "save",
    productId: products[0]!.id,
    name: updatedName,
    variants: expect.arrayContaining([
      expect.objectContaining({ sku: "MULTI-PRETO-39", stock: 4 }),
      expect.objectContaining({ sku: "MULTI-PRETO-40", stock: 3 })
    ])
  });

  const updatedRow = page.locator("article.managed-product").filter({ hasText: updatedName });
  await updatedRow.locator("details.product-action-menu > summary").click();
  await updatedRow.getByRole("button", { name: "Desativar" }).click();
  await expect(page.getByText("Status do produto atualizado.")).toBeVisible();
  expect(savedPayload).toMatchObject({ action: "status", productId: products[0]!.id, status: "draft" });
  await expect(
    page.locator("article.managed-product").filter({ hasText: updatedName }).getByText("Não ativo", { exact: true })
  ).toBeVisible();

  const inactiveRow = page.locator("article.managed-product").filter({ hasText: updatedName });
  await inactiveRow.locator("details.product-action-menu > summary").click();
  await inactiveRow.getByRole("button", { name: "Duplicar" }).click();
  const duplicateName = `${updatedName} — cópia E2E`;
  await page
    .getByRole("dialog", { name: "Duplicar produto" })
    .getByLabel("Novo nome")
    .fill(duplicateName);
  await page
    .getByRole("dialog", { name: "Duplicar produto" })
    .getByLabel("Novo slug")
    .fill("produto-copia-e2e");
  await page
    .getByRole("dialog", { name: "Duplicar produto" })
    .getByRole("button", { name: "Duplicar" })
    .click();
  await expect(page.getByText(duplicateName)).toBeVisible();

  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  const createDialog = page.locator(".panel-drawer");
  await expect(createDialog).toBeVisible();
  const patchesBeforeInvalidSave = catalogPatches;
  await page.keyboard.press("Control+s");
  await expect(createDialog.getByLabel("Nome *")).toBeFocused();
  await expect(createDialog).toBeVisible();
  expect(catalogPatches).toBe(patchesBeforeInvalidSave);
  expect(savedPayload).toMatchObject({ action: "duplicate" });
  await createDialog.getByLabel("Nome *").fill("Produto criado no fluxo E2E");
  await createDialog.getByLabel("Slug (opcional)").fill("produto-criado-fluxo-e2e");
  const categoryCheckbox = createDialog.getByRole("group", { name: "Categorias", exact: true })
    .getByRole("checkbox", { name: "Sandálias", exact: true });
  await categoryCheckbox.check();
  await expect(categoryCheckbox).toBeChecked();
  await expect(createDialog.getByRole("button", { name: "Sandálias como categoria principal" }))
    .toHaveAttribute("aria-pressed", "true");
  await createDialog.getByLabel("Preço de venda *").fill("79.90");
  await createDialog.getByLabel("Custo (R$)").fill("30.00");
  await createDialog.getByLabel("Peso (g)").fill("300");
  await createDialog.getByLabel("Altura (cm)").fill("8");
  await createDialog.getByLabel("Largura (cm)").fill("18");
  await createDialog.getByLabel("Comprimento (cm)").fill("27");
  await createDialog.getByLabel("Resumo curto").fill("Produto criado pelo fluxo completo");
  await createDialog
    .getByLabel("Descrição", { exact: true })
    .fill("Cadastro validado sem dados reais de produção.");
  await createDialog.getByRole("spinbutton", { name: /^Estoque disponível/u }).fill("5");
  expect(await createDialog.locator("form").evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(true);
  await expect.poll(() => draftWrites).toBeGreaterThan(0);
  expect(productDraft).not.toBeNull();
  await createDialog.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.locator("article.managed-product")
    .getByRole("heading", { name: "Produto criado no fluxo E2E", exact: true })).toBeVisible();
  expect(savedPayload).toMatchObject({ action: "save", name: "Produto criado no fluxo E2E",
    status: "draft", categoryId, categoryIds: [categoryId], priceInCents: 7990,
    variants: expect.arrayContaining([expect.objectContaining({ color: "Padrão", size: "Único", stock: 5, active: true })]) });
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("curtiz:product-draft:v1:")))).toEqual([]);
  const writesAfterSave = draftWrites;

  for (const route of ["modelos", "variacoes", "midias", "estoque"]) {
    await page.goto(`/administracao/${route}`);
    await expect(page.getByRole("heading", { name: updatedName, exact: true })).toBeVisible();
    await expect(page.getByText("Falha ao carregar")).toHaveCount(0);
  }
  expect(draftWrites).toBe(writesAfterSave);
  expect(productDraft).toBeNull();
  expect(failures).toEqual([]);
});
