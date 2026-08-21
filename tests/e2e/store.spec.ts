import { expect, test } from "@playwright/test";

test("navega da home ao produto e adiciona ao carrinho", async ({ page }) => {
  test.setTimeout(60_000);
  const cartSyncRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/cart/sync")) cartSyncRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator(".homepage-hero")).toBeVisible();
  await Promise.all([
    page.waitForURL("**/produto/flip-flop-wave-preto", { timeout: 20_000 }),
    page.getByRole("link", { name: "curti Z Flip-Flop Wave Preto" }).first().click()
  ]);
  await expect(page.getByRole("group", { name: "Tamanho" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Adicionar ao carrinho/i }).click();
  await expect(page.getByRole("button", { name: /Adicionado ao carrinho/i })).toBeVisible();
  await page.getByRole("link", { name: /Carrinho com 1 itens/i }).click();
  await page.waitForURL("**/carrinho", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Meu carrinho" })).toBeVisible({
    timeout: 15_000
  });
  await page.waitForTimeout(700);
  expect(cartSyncRequests).toHaveLength(0);
  await expect(page.locator(".cart-sync-notice")).toHaveCount(0);
});

test("gerencia a remoção do carrinho somente após seleção explícita", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "curtiz-cookie-consent",
      JSON.stringify({ categories: { essential: true } })
    );
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
        },
        {
          productId: "slim-coral",
          slug: "flip-flop-slim-coral",
          category: "Feminino",
          variantId: "slim-coral:Coral:35/36",
          name: "curti Z Flip-Flop Slim Coral",
          image: "/images/products/slim-coral.png",
          color: "Coral",
          size: "35/36",
          quantity: 1,
          maxQuantity: 10,
          unitPriceInCents: 5490
        }
      ])
    );
  });

  await page.goto("/carrinho", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".cart-item")).toHaveCount(2);
  await expect(page.getByText("Sua seleção", { exact: true })).toHaveCount(0);

  const continueShopping = page.getByRole("link", { name: "Continuar comprando" }).first();
  const title = page.getByRole("heading", { name: "Meu carrinho" });
  const [continueBounds, titleBounds] = await Promise.all([
    continueShopping.boundingBox(),
    title.boundingBox()
  ]);
  expect(continueBounds).not.toBeNull();
  expect(titleBounds).not.toBeNull();
  expect((continueBounds?.y ?? 0) + (continueBounds?.height ?? 0)).toBeLessThanOrEqual(
    titleBounds?.y ?? 0
  );

  const manage = page.getByRole("button", { name: "Selecionar produtos para remover" });
  await manage.click();
  await expect(page.locator(".cart-item")).toHaveCount(2);
  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(2);
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await expect(page.getByText("2 produtos selecionados", { exact: true })).toBeVisible();
  await expect(page.locator(".cart-item.is-selected")).toHaveCount(2);

  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(checkboxes).toHaveCount(0);
  await expect(page.locator(".cart-item")).toHaveCount(2);

  await manage.click();
  await page.getByRole("checkbox", { name: "Selecionar curti Z Flip-Flop Wave Preto" }).check();
  await page.getByRole("button", { name: "Remover selecionados" }).click();
  await expect(page.getByRole("heading", { name: "curti Z Flip-Flop Wave Preto" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "curti Z Flip-Flop Slim Coral" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  await page.locator(".cart-item").getByRole("button", { name: "Remover" }).click();
  await expect(page.getByRole("heading", { name: "Sua sacola está vazia." })).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".cart-item")).toHaveCount(2);
  await manage.click();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Remover todos os itens da sacola?");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Limpar tudo" }).click();
  await expect(page.locator(".cart-item")).toHaveCount(2);

  page.once("dialog", async (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Limpar tudo" }).click();
  await expect(page.getByRole("heading", { name: "Sua sacola está vazia." })).toBeVisible();
});

test("catálogo e busca carregam somente resultados paginados", async ({ page }) => {
  const catalogResponse = await page.goto("/produtos");
  expect(catalogResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Todos os produtos" })).toBeVisible();
  const catalogProducts = await page.locator(".product-card").count();
  expect(catalogProducts).toBeGreaterThan(0);
  expect(catalogProducts).toBeLessThanOrEqual(12);

  const searchResponse = await page.goto("/busca?q=Wave");
  expect(searchResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /Busca/ })).toBeVisible();
  const visibleProducts = await page.locator(".product-card").count();
  expect(visibleProducts).toBeGreaterThan(0);
  expect(visibleProducts).toBeLessThanOrEqual(12);
});

test("checkout valida os dados e bloqueia pagamento indisponível sem criar pedido", async ({
  page
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "curtiz-cookie-consent",
      JSON.stringify({ categories: { essential: true } })
    );
    localStorage.setItem(
      "curtiz-cart",
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
          unitPriceInCents: 1
        }
      ])
    );
  });
  const login = await page.request.post("http://localhost:3000/api/auth/login", {
    data: { email: "cliente.demo@curtiz.local", password: "1234567890" }
  });
  expect(login.ok()).toBe(true);

  const checkoutPayload = {
    idempotencyKey: crypto.randomUUID(),
    customer: {
      name: "Cliente curti Z",
      email: "cliente.demo@curtiz.local",
      phone: "11999999999",
      cpf: "52998224725"
    },
    address: {
      postalCode: "01310100",
      street: "Avenida Paulista",
      number: "1000",
      complement: "",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP"
    },
    lines: [
      {
        productId: "wave-preto",
        variantId: "wave-preto:Preto:39/40",
        color: "Preto",
        size: "39/40",
        quantity: 1
      }
    ]
  };
  for (const customer of [
    { ...checkoutPayload.customer, cpf: "11111111111" },
    { ...checkoutPayload.customer, phone: "319999999999999" },
    { ...checkoutPayload.customer, email: `${"a".repeat(110)}@example.com.br` }
  ]) {
    const invalidResponse = await page.request.post("http://localhost:3000/api/checkout", {
      data: { ...checkoutPayload, idempotencyKey: crypto.randomUUID(), customer },
      headers: { origin: "http://localhost:3000" }
    });
    expect(invalidResponse.status()).toBe(400);
  }

  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Finalizar compra" })).toBeVisible();
  await expect(page.getByText("Ambiente protegido", { exact: true })).toHaveCount(0);
  await expect(page.locator('.checkout-steps [aria-current="step"]')).toContainText("Dados");

  for (const width of [320, 375, 390, 430, 768, 1366, 1920]) {
    await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    if (width <= 700) {
      await expect(page.getByText("Etapa 2 de 7", { exact: true })).toBeVisible();
      await expect(page.locator(".checkout-steps")).toBeHidden();
    } else {
      await expect(page.locator(".checkout-steps")).toBeVisible();
      await expect(page.locator(".checkout-progress-mobile")).toBeHidden();
    }
  }
  await page.setViewportSize({ width: 1366, height: 900 });

  await page.getByLabel("Nome completo").fill("Cliente curti Z");
  const email = page.getByLabel("E-mail");
  await email.focus();
  await page.keyboard.insertText(`${"a".repeat(130)}@example.com`);
  expect((await email.inputValue()).length).toBe(120);
  await email.fill("cliente.demo@curtiz.local");
  const phone = page.getByLabel("Telefone");
  await phone.fill("119999999999999");
  await expect(phone).toHaveValue("(11) 99999-9999");
  const cpf = page.getByLabel("CPF para o pedido");
  await cpf.fill("11111111111");
  await page.getByRole("button", { name: "Confirmar e pagar" }).click();
  await expect(page.locator("#checkout-cpf-error")).toHaveText("Informe um CPF válido.");
  await cpf.fill("5299822472512345");
  await expect(cpf).toHaveValue("529.982.247-25");
  await page.getByLabel("CEP").fill("01310100");
  await page.getByLabel("Endereço").fill("Avenida Paulista");
  await page.getByLabel("Número").fill("1000");
  await page.getByLabel("Bairro").fill("Bela Vista");
  await page.getByLabel("Cidade").fill("São Paulo");
  await page.getByLabel("Estado").selectOption("SP");
  await page.getByRole("button", { name: "Confirmar e pagar" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("heading", { name: "Pagamento online indisponível no momento" })
  ).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText(
    "Não foi possível concluir o pagamento. Nenhuma cobrança foi realizada."
  );
  await expect(dialog).not.toContainText(/demo|demonstração|fictício|Mercado Pago/i);
  await expect(page).toHaveURL(/\/checkout$/);
});

test("preserva o retorno do login e abre atendimento humano", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/ajuda");
  await expect(page.getByRole("button", { name: /Entregas e rastreamento/i })).toBeVisible();
  await page.getByRole("button", { name: "Novo chamado" }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("E-mail de acesso").fill("cliente.demo@curtiz.local");
  await page.locator('input[name="password"]:visible').fill("1234567890");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await expect(page).toHaveURL(/\/minha-conta\/atendimento\?new=1/, { timeout: 30_000 });
  await page.getByLabel("Assunto").fill("Prazo da entrega do pedido");
  await page
    .getByLabel("Mensagem inicial")
    .fill("Preciso confirmar o prazo atualizado da minha entrega.");
  await page.getByRole("button", { name: /Enviar para a equipe/i }).click();
  await expect(
    page.getByText(/Seu chamado foi enviado e aguarda atendimento/i).first()
  ).toBeVisible();
});

test("pesquisa, abre e limpa artigos da Central de Ajuda", async ({ page }) => {
  await page.goto("/ajuda");

  await expect(page.getByRole("heading", { name: "Olá! Como podemos ajudar?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Compras/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Segurança e privacidade/i })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Pesquisar na Central de Ajuda" });
  await search.fill("pagamento");
  const paymentArticle = page.locator(".help-result-grid article", {
    hasText: "Quais formas de pagamento estão disponíveis?"
  });
  await expect(paymentArticle).toBeVisible();
  await paymentArticle.getByRole("button", { name: /Ler conteúdo/i }).click();
  await expect(
    page
      .locator(".help-reader")
      .getByRole("heading", { name: "Quais formas de pagamento estão disponíveis?" })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver política de pagamento" })).toHaveAttribute(
    "href",
    "/politicas/pagamento"
  );

  await page.getByRole("button", { name: "Limpar busca" }).click();
  await expect(search).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test("oferece um único acesso para clientes e equipe", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Acesse sua conta" })).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Use seu e-mail e senha cadastrados para continuar.").first()
  ).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Cadastre-se" })).toHaveAttribute(
    "href",
    "/cadastro"
  );
});

test("respeita Manter conectado e limpa o carrinho no logout", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "curtiz-cookie-consent",
      JSON.stringify({ categories: { essential: true } })
    );
  });
  await page.goto("/produto/flip-flop-wave-preto", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("group", { name: "Tamanho" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Adicionar ao carrinho/i }).click();
  await expect(page.getByRole("button", { name: /Adicionado ao carrinho/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Carrinho com 1 itens/i })).toBeVisible();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("E-mail de acesso").fill("cliente.demo@curtiz.local");
  await page.locator('input[name="password"]:visible').fill("1234567890");
  await expect(page.getByLabel("Lembrar meu acesso neste dispositivo")).not.toBeChecked();
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await expect(page).toHaveURL(/\/minha-conta$/u, { timeout: 20_000 });

  const sessionCookies = await context.cookies();
  expect(sessionCookies.find((cookie) => cookie.name === "curtiz-demo-session")?.expires).toBe(-1);
  expect(sessionCookies.find((cookie) => cookie.name === "curtiz-auth-persistence")?.expires).toBe(
    -1
  );
  const cartStorage = await page.evaluate(() => ({
    persistent: localStorage.getItem("curtiz-cart"),
    session: JSON.parse(sessionStorage.getItem("curtiz-session-cart") ?? "[]") as Array<{
      productId?: string;
    }>
  }));
  expect(cartStorage.persistent).toBeNull();
  expect(cartStorage.session.map((line) => line.productId)).toEqual(["wave-preto"]);

  await page.getByRole("button", { name: "Sair da conta" }).first().click();
  await expect(page).toHaveURL(/\/login$/u, { timeout: 20_000 });
  const logoutState = await page.evaluate(() => ({
    persistent: JSON.parse(localStorage.getItem("curtiz-cart") ?? "[]") as unknown[],
    session: sessionStorage.getItem("curtiz-session-cart")
  }));
  expect(logoutState).toEqual({ persistent: [], session: null });
  expect((await context.cookies()).some((cookie) => cookie.name === "curtiz-demo-session")).toBe(
    false
  );

  await page.getByLabel("E-mail de acesso").fill("cliente.demo@curtiz.local");
  await page.locator('input[name="password"]:visible').fill("1234567890");
  await page.getByLabel("Lembrar meu acesso neste dispositivo").check();
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await expect(page).toHaveURL(/\/minha-conta$/u, { timeout: 20_000 });
  const persistentCookies = await context.cookies();
  const nowInSeconds = Date.now() / 1_000;
  expect(
    persistentCookies.find((cookie) => cookie.name === "curtiz-demo-session")?.expires ?? -1
  ).toBeGreaterThan(nowInSeconds);
  expect(
    persistentCookies.find((cookie) => cookie.name === "curtiz-auth-persistence")?.expires ?? -1
  ).toBeGreaterThan(nowInSeconds);
});

test("login encontra o footer sem faixa estrutural vazia", async ({ page }) => {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Acesse sua conta" })).toBeVisible();

    const layout = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>("#main-content");
      const authPage = document.querySelector<HTMLElement>(".auth-page");
      const authShell = document.querySelector<HTMLElement>(".auth-shell");
      const footer = document.querySelector<HTMLElement>(".site-footer");
      if (!main || !authPage || !authShell || !footer)
        throw new Error("Estrutura do login incompleta.");
      const mainBounds = main.getBoundingClientRect();
      const authBounds = authPage.getBoundingClientRect();
      const shellBounds = authShell.getBoundingClientRect();
      const footerBounds = footer.getBoundingClientRect();
      return {
        footerGap: footerBounds.top - mainBounds.bottom,
        authGap: mainBounds.bottom - authBounds.bottom,
        footerMargin: window.getComputedStyle(footer).marginTop,
        shellCenter: shellBounds.left + shellBounds.width / 2,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });

    expect(Math.abs(layout.footerGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.authGap)).toBeLessThanOrEqual(1);
    expect(layout.footerMargin).toBe("0px");
    expect(Math.abs(layout.shellCenter - viewport.width / 2)).toBeLessThanOrEqual(1);
    expect(layout.pageOverflow).toBeLessThanOrEqual(1);
  }
});

test("autentica conta operacional no modo demo local sem Supabase", async ({ page }) => {
  await page.goto("/login");
  const email = page.locator('input[name="email"]:visible');
  await email.fill("operacional.demo@curtiz.local");
  await page.locator('input[name="password"]:visible').fill("1234567890");
  await expect(email).toHaveValue("operacional.demo@curtiz.local");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();

  await expect(page).toHaveURL("http://localhost:3001/operacional", {
    timeout: 20_000
  });
  await expect(page.getByRole("heading", { name: "Operacional", exact: true })).toBeVisible();
});

test("mantém favoritos entre páginas para a conta demo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Favoritar curti Z Flip-Flop Wave Preto" }).click();

  await page.goto("/login");
  await page.getByLabel("E-mail de acesso").fill("cliente.demo@curtiz.local");
  await page.locator('input[name="password"]:visible').fill("1234567890");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await page.waitForURL("**/minha-conta", { timeout: 20_000 });
  await page.goto("/minha-conta/favoritos");

  await expect(page.getByRole("heading", { name: "Seus favoritos" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "curti Z Flip-Flop Wave Preto" }).first()
  ).toBeVisible();
});

test("entrega a Central da Conta mobile responsiva sem dados fictícios", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/minha-conta");
  await expect(page.getByRole("heading", { name: "Entre na sua conta curti Z" })).toBeVisible();
  await page.getByRole("link", { name: "Entrar", exact: true }).click();
  await page.getByLabel("E-mail de acesso").fill("cliente.demo@curtiz.local");
  await page.locator('input[name="password"]:visible').fill("1234567890");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();

  await expect(page).toHaveURL(/\/minha-conta$/, { timeout: 20_000 });
  await expect(page.getByText("#CZT-DEMO01")).toHaveCount(0);

  for (const width of [320, 360, 375, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".account-mobile-home")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Olá, Cliente" })).toBeVisible();
    await expect(page.getByText("cliente.demo@curtiz.local")).toBeVisible();
    await expect(page.locator(".customer-account-nav")).toBeHidden();
    await expect(
      page.locator(".account-mobile-menu-copy strong", {
        hasText: "Seja um representante"
      })
    ).toHaveText("Seja um representante");
    await expect(
      page
        .locator(".account-mobile-menu")
        .getByText("Conheça o programa de representantes", { exact: true })
    ).toBeVisible();
    await expect(page.locator(".help-widget")).toBeHidden();
    await expect(page.locator(".site-header")).toBeVisible();
    await expect(page.locator(".cart-link")).toBeVisible();

    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(pageOverflow).toBeLessThanOrEqual(1);
  }

  await page.getByRole("link", { name: /Meu perfil/ }).click();
  await expect(page).toHaveURL(/\/minha-conta\/perfil$/);
  await expect(page.locator(".account-mobile-subpage-header")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Perfil", exact: true })).toBeVisible();
  await expect(page.getByLabel("Nome completo")).toHaveValue("Cliente Demo");
  await page.getByRole("link", { name: "Voltar", exact: true }).click();
  await expect(page).toHaveURL(/\/minha-conta$/);

  for (const width of [768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".account-mobile-home")).toBeHidden();
    await expect(page.locator(".customer-account-desktop-header")).toBeVisible();
    await expect(page.locator(".customer-account-nav")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sua conta em resumo" })).toBeVisible();
  }

  await page.goto("/perfil");
  await expect(page.locator(".help-widget")).toBeHidden();
  await page.goto("/favoritos");
  await expect(page.locator(".help-widget")).toBeHidden();
  await page.goto("/");
  await expect(page.locator(".help-widget")).toBeVisible();
});

test("oferece o Painel do representante sem remover a conta de cliente", async ({ page }) => {
  test.setTimeout(90_000);
  const login = await page.request.post("http://localhost:3000/api/auth/login", {
    data: { email: "representante.demo@curtiz.local", password: "1234567890" }
  });
  expect(login.ok()).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/minha-conta", { waitUntil: "domcontentloaded" });
  const representativeAccess = page.locator(".account-mobile-menu-copy strong", {
    hasText: "Painel do representante"
  });
  await expect(representativeAccess).toHaveText("Painel do representante");
  await expect(page.getByText("Painel da representante", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Portal do representante", { exact: true })).toHaveCount(0);
  await expect(page.locator(".help-widget")).toBeHidden();
  await page.getByRole("link", { name: "Painel do representante", exact: true }).click();
  await expect(page).toHaveURL(/\/representante$/, { timeout: 30_000 });
  await expect(page.locator(".representative-portal-layout")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /Voltar à área de cliente/i })).toBeAttached();
  await expect(page.locator(".help-widget")).toBeHidden();
});

test("portal da representante mantém a identidade visual da área do cliente", async ({ page }) => {
  test.setTimeout(240_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|react|content security policy/i.test(message.text())
    ) {
      runtimeErrors.push(message.text());
    }
  });
  const login = await page.request.post("http://localhost:3000/api/auth/login", {
    data: { email: "representante.demo@curtiz.local", password: "1234567890" }
  });
  expect(login.ok()).toBe(true);

  // Este teste valida todos os breakpoints abaixo por conta própria.
  // Começar em desktop evita que asserts de identidade visual desktop
  // dependam do viewport inicial do projeto Playwright (store-desktop/store-mobile).
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/representante", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".representative-portal-layout")).toHaveCSS(
    "background-color",
    "rgb(238, 238, 238)"
  );
  await expect(page.locator(".representative-sidebar")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)"
  );
  await expect(page.locator(".representative-topbar")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)"
  );
  await expect(page.getByRole("link", { name: /Voltar à área de cliente/i })).toBeAttached();
  await expect(page.locator(".representative-topbar-identity .user-avatar")).toBeVisible();
  await expect(page.locator(".representative-nav-group")).toHaveCount(5);
  await expect(page.locator(".representative-primary-metrics article")).toHaveCount(4);
  await expect(page.locator(".representative-situation-metrics article")).toHaveCount(4);
  await expect(page.locator(".representative-topbar-profile .representative-status")).toBeVisible();
  const representativeRoutes = await page
    .locator(".representative-sidebar nav a")
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));

  const responsiveCases = [
    { width: 1920, columns: 4 },
    { width: 1366, columns: 4 },
    { width: 1024, columns: 2 },
    { width: 768, columns: 2 },
    { width: 430, columns: 1 },
    { width: 390, columns: 1 },
    { width: 320, columns: 1 }
  ];

  for (const viewport of responsiveCases) {
    await page.setViewportSize({ width: viewport.width, height: 900 });
    const columns = await page
      .locator(".representative-primary-metrics")
      .evaluate(
        (element) => window.getComputedStyle(element).gridTemplateColumns.split(" ").length
      );
    expect(columns).toBe(viewport.columns);
    const hasPageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(hasPageOverflow).toBe(false);
  }

  await page.setViewportSize({ width: 1366, height: 900 });
  for (const route of representativeRoutes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".representative-page-title")).toBeVisible();
    const hasPageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(hasPageOverflow).toBe(false);
  }
  expect(runtimeErrors).toEqual([]);
});

test("permite consultar favoritos antes do login", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Favoritar curti Z Flip-Flop Wave Preto" }).click();
  await page.goto("/favoritos");

  await expect(page).toHaveURL(/\/favoritos$/);
  await expect(page.getByRole("heading", { name: "Favoritos", exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "curti Z Flip-Flop Wave Preto" }).first()
  ).toBeVisible();
});

test("chat flutuante responde a uma saudação e o launcher também fecha", async ({ page }) => {
  await page.goto("/");
  const rejectCookies = page.getByRole("button", { name: "Rejeitar opcionais" });
  await expect(rejectCookies).toBeVisible({ timeout: 10_000 });
  await rejectCookies.click();
  await page.getByRole("button", { name: "Abrir ajuda" }).click();
  await expect(page.getByRole("dialog", { name: "Ajuda curti Z" })).toBeVisible();
  await page.getByLabel("Digite sua mensagem").fill("Oi");
  await page.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(page.getByText(/Como posso ajudar você hoje/i)).toBeVisible();
  await page.getByRole("button", { name: "Fechar ajuda" }).click();
  await expect(page.getByRole("dialog", { name: "Ajuda curti Z" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Abrir ajuda" })).toBeFocused();
});

test("preserva o carrinho durante a hidratação", async ({ page }) => {
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
  await page.goto("/carrinho");
  await expect(page.getByRole("heading", { name: "curti Z Flip-Flop Wave Preto" })).toBeVisible();
  await expect(page.getByText("R$ 59,90").first()).toBeVisible();
});

test("mescla e preserva o carrinho depois do login sem loop ou 503", async ({ page }) => {
  test.setTimeout(90_000);
  const syncStatuses: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/cart/sync")) syncStatuses.push(response.status());
  });

  await page.goto("/produto/flip-flop-wave-preto");
  await page.getByRole("button", { name: /Adicionar ao carrinho/i }).click();
  await page.goto("/login?next=%2Fcarrinho");
  await page.getByLabel("E-mail de acesso").fill("cliente.demo@curtiz.local");
  await page.locator('input[name="password"]:visible').fill("1234567890");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();

  await expect(page).toHaveURL(/\/carrinho$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "curti Z Flip-Flop Wave Preto" })).toBeVisible();
  await expect.poll(() => syncStatuses.length).toBeGreaterThan(0);
  expect(syncStatuses).not.toContain(503);

  await page
    .getByRole("button", { name: /Aumentar quantidade de curti Z Flip-Flop Wave Preto/i })
    .click();
  await expect(page.getByLabel("Quantidade atual: 2")).toBeVisible();
  await expect.poll(() => syncStatuses.length).toBeGreaterThan(1);
  expect(syncStatuses).not.toContain(503);

  await page.reload();
  await expect(page.getByLabel("Quantidade atual: 2")).toBeVisible();
  await page.waitForTimeout(700);
  expect(syncStatuses).not.toContain(503);
  expect(syncStatuses.length).toBeLessThanOrEqual(4);
  await expect(page.locator(".cart-sync-notice")).toHaveCount(0);
});

test("rejeita quantidades inválidas na sincronização", async ({ page }) => {
  for (const quantity of [-1, 0, 100_000, "NaN"]) {
    const response = await page.request.post("http://localhost:3000/api/cart/sync", {
      headers: { origin: "http://localhost:3000" },
      data: {
        lines: [
          {
            productId: "wave-preto",
            variantId: "wave-preto:Preto:39/40",
            name: "curti Z Flip-Flop Wave Preto",
            image: "/images/products/wave-preto.png",
            color: "Preto",
            size: "39/40",
            quantity,
            maxQuantity: 10,
            unitPriceInCents: 5990
          }
        ]
      }
    });
    expect(response.status()).toBe(400);
  }
});

test("recomenda produtos diferentes e mantém o total móvel ligado ao carrinho", async ({
  page
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "curtiz-cookie-consent",
      JSON.stringify({ categories: { essential: true } })
    );
  });
  await page.goto("/produto/flip-flop-wave-preto", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("group", { name: "Tamanho" })).toBeVisible({ timeout: 30_000 });
  const addToCart = page.getByRole("button", { name: /Adicionar ao carrinho/i });
  const cartWithItem = page.getByRole("link", { name: /Carrinho com 1 itens/i });
  await expect(async () => {
    if ((await cartWithItem.count()) === 0) await addToCart.click();
    await expect(cartWithItem).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await cartWithItem.click();
  await expect(page).toHaveURL(/\/carrinho$/u, { timeout: 30_000 });

  const recommendations = page.locator(".cart-recommendation-grid .product-card");
  await expect(page.getByRole("heading", { name: "Você também pode gostar" })).toBeVisible();
  await expect.poll(() => recommendations.locator("h3 a").count()).toBeGreaterThan(0);
  await expect(recommendations.locator('a[href="/produto/flip-flop-wave-preto"]')).toHaveCount(0);
  const recommendedLink = recommendations.first().locator("h3 a");
  const recommendedHref = await recommendedLink.getAttribute("href");
  expect(recommendedHref).toMatch(/^\/produto\//u);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator(".cart-recommendation-grid")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)
  ).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  const mobileSummary = page.locator(".cart-mobile-summary");
  await expect(mobileSummary).toBeVisible();
  await expect(page.locator(".cart-summary")).toBeHidden();
  await expect(mobileSummary.getByText("R$ 59,90")).toBeVisible();
  await expect(mobileSummary.getByRole("link", { name: "Comprar" })).toHaveAttribute(
    "href",
    "/checkout"
  );
  await page
    .getByRole("button", { name: /Aumentar quantidade de curti Z Flip-Flop Wave Preto/i })
    .click();
  await expect(mobileSummary.getByText("R$ 119,80")).toBeVisible();
  await expect(page.getByText("Entrega calculada no checkout")).toHaveCount(0);

  await recommendedLink.click();
  await expect(page).toHaveURL(new RegExp(`${recommendedHref?.replaceAll("/", "\\/")}$`, "u"));
});

test("galeria do produto abre lightbox acessível e restaura o foco", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/produto/flip-flop-wave-preto", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("group", { name: "Tamanho" })).toBeVisible({ timeout: 30_000 });
  const trigger = page.getByRole("button", {
    name: "Abrir visualização de curti Z Flip-Flop Wave Preto"
  });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Ampliar", { exact: true })).toHaveCount(0);
  await expect(trigger.locator("img")).toHaveCSS("object-fit", "cover");
  const selectedSource = await trigger.locator("img").getAttribute("src");

  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Visualização ampliada de curti Z Flip-Flop Wave Preto"
  });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "Fechar visualização ampliada" });
  await expect(close).toBeFocused();
  await expect(dialog.locator(".product-lightbox-image img")).toHaveCSS("object-fit", "contain");
  expect(await dialog.locator(".product-lightbox-image img").getAttribute("src")).toBe(
    selectedSource
  );
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

  const viewport = dialog.locator(".product-lightbox-image");
  await viewport.hover();
  await page.mouse.wheel(0, -600);
  await expect
    .poll(() =>
      dialog.locator(".product-lightbox-transform").evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return matrix.a;
      })
    )
    .toBeGreaterThan(1);
  await dialog.getByRole("button", { name: "Redefinir zoom" }).click();
  await expect
    .poll(() =>
      dialog.locator(".product-lightbox-transform").evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return matrix.a;
      })
    )
    .toBe(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("vitrines mobile mantêm duas colunas sem overflow", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".homepage-hero:visible").first()).toBeVisible({ timeout: 30_000 });
  const shelves = page.locator(".home-product-row, .product-grid");
  await expect.poll(() => shelves.count(), { timeout: 20_000 }).toBeGreaterThan(0);

  for (const width of [320, 360, 375, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const columns = await shelves.evaluateAll((elements) =>
      elements
        .filter((element) => element.getBoundingClientRect().width > 0)
        .map((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)
    );
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.every((count) => count === 2)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )
    ).toBe(true);
  }
});

test("404 preserva status, recuperação e recomendações reais", async ({ page }) => {
  test.setTimeout(90_000);
  const response = await page.goto("/pagina-inexistente-curtiz", {
    waitUntil: "domcontentloaded"
  });

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Não encontramos esta página." })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
  await expect(page.getByRole("link", { name: /Voltar ao início/i })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: /Continuar comprando/i })).toHaveAttribute(
    "href",
    "/produtos"
  );
  const recommendations = page.locator(".error-recommendation-grid .product-card");
  await expect
    .poll(() => recommendations.locator("h3 a").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(recommendations.first().locator("h3 a")).toHaveAttribute("href", /^\/produto\//u);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator(".error-recommendation-grid")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)
  ).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );

  await page.getByRole("link", { name: /Voltar ao início/i }).click();
  await expect(page).toHaveURL(/\/$/u, { timeout: 20_000 });
});

test("404 continua utilizável quando as recomendações falham sem repetir requisições", async ({
  page
}) => {
  let catalogRequests = 0;
  await page.route("**/api/catalog**", async (route) => {
    catalogRequests += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  const response = await page.goto("/outra-pagina-inexistente-curtiz", {
    waitUntil: "domcontentloaded"
  });

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Não encontramos esta página." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Voltar ao início/i })).toBeVisible();
  await expect.poll(() => catalogRequests, { timeout: 15_000 }).toBe(1);
  await expect(page.locator(".error-recommendations")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(catalogRequests).toBe(1);
});

test("produto inexistente usa 404 específica sem expor detalhes", async ({ page }) => {
  const response = await page.goto("/produto/produto-que-nao-existe", {
    waitUntil: "domcontentloaded"
  });

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Produto não encontrado." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ver outros produtos/i })).toHaveAttribute(
    "href",
    "/produtos"
  );
  await expect(page.getByText(/supabase|sql|exception|stack|token/iu)).toHaveCount(0);
});
