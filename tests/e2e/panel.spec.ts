import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, email: string) {
  await page.goto("http://localhost:3000/login");
  await page.getByLabel("E-mail de acesso").fill(email);
  await page.getByPlaceholder("Digite sua senha").first().fill("1234567890");
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  const destination = email.startsWith("tecnico") ? "tecnico" : "administracao";
  await page.waitForURL(`http://localhost:3001/${destination}`, {
    timeout: 20_000
  });
}

test("painel técnico não finge integrações conectadas", async ({ page }) => {
  await loginAs(page, "tecnico.demo@curtiz.local");
  await page.goto("/tecnico/integracoes");
  await expect(page.getByRole("heading", { name: "Integracoes" })).toBeVisible();
  await expect(page.getByText("Não configurado").first()).toBeVisible();
  await expect(page.getByText("Aguardando credenciais")).toBeVisible();
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
  await expect(page.getByText(/pode levar de 1 a 3 horas/i)).toBeVisible();

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
