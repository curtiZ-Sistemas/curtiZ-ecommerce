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
}

for (const account of [
  { email: "admin.demo@curtiz.local", route: "administracao" },
  { email: "operacional.demo@curtiz.local", route: "operacional" },
  { email: "gerencia.demo@curtiz.local", route: "gerencia" },
  { email: "tecnico.demo@curtiz.local", route: "tecnico" }
] as const) {
  test(`abre a rota inicial de ${account.route} sem Server Component crash`, async ({ page }) => {
    test.setTimeout(90_000);
    await loginAs(page, account.email);
    await expect(page).toHaveURL(`http://localhost:3001/${account.route}`);
    await expect(page.getByText("Falha ao carregar")).toHaveCount(0);
    await expect(page.locator("main")).toBeVisible();
  });
}

test("painel técnico não finge integrações conectadas", async ({ page }) => {
  await loginAs(page, "tecnico.demo@curtiz.local");
  await page.goto("/tecnico/integracoes");
  await expect(page.getByRole("heading", { name: "Integracoes" })).toBeVisible();
  await expect(page.getByText("Não configurado").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Aguardando credenciais")).toBeVisible({ timeout: 20_000 });
});

test("novo suporte aparece na fila administrativa", async ({ page }) => {
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
  await loginAs(page, "admin.demo@curtiz.local");
  await page.getByRole("button", { name: "Sair do painel" }).click();
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
