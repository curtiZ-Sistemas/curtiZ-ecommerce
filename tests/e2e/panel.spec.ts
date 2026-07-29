import { expect, test } from "@playwright/test";

test("painel técnico não finge integrações conectadas", async ({ page }) => {
  await page.goto("/tecnico/integracoes");
  await expect(page.getByRole("heading", { name: "Integracoes" })).toBeVisible();
  await expect(page.getByText("Não configurado").first()).toBeVisible();
  await expect(page.getByText("Aguardando credenciais")).toBeVisible();
});

test("novo suporte aparece na fila administrativa", async ({ page }) => {
  await page.goto("/administracao/atendimentos");
  await expect(page.getByText("Fila de atendimentos")).toBeVisible();
  await expect(page.getByText("Fila do Administrador")).toBeVisible();
});
