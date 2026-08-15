import { expect, test } from "@playwright/test";

test("navega da home ao produto e adiciona ao carrinho", async ({ page }) => {
  test.setTimeout(60_000);
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
  await expect(page.getByText(/Seu chamado foi enviado e aguarda atendimento/i).first()).toBeVisible();
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

test("entrega a área customer sem dados fictícios e sem overflow mobile", async ({ page }) => {
  await page.goto("/minha-conta");
  await expect(page.getByRole("heading", { name: "Entre na sua conta curti Z" })).toBeVisible();
  await page.getByRole("link", { name: "Entrar", exact: true }).click();
  await page.getByLabel("E-mail de acesso").fill("cliente.demo@curtiz.local");
  await page.locator('input[name="password"]:visible').fill("1234567890");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();

  await expect(page).toHaveURL(/\/minha-conta$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Sua conta em resumo" })).toBeVisible();
  await expect(page.getByText("#CZT-DEMO01")).toHaveCount(0);
  await page.getByRole("link", { name: "Perfil", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dados pessoais" })).toBeVisible();
  await expect(page.getByLabel("Nome completo")).toHaveValue("Cliente Demo");

  const hasPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  expect(hasPageOverflow).toBe(false);
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
