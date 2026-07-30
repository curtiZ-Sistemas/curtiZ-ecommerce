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
  await loginAs(page, "admin.demo@curtiz.local");
  await page.goto("/administracao/atendimentos");
  await expect(page.getByText("Fila de atendimentos")).toBeVisible();
  await expect(page.getByText("Fila do Administrador")).toBeVisible();
});
