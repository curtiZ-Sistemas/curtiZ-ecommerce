import { expect, test } from "@playwright/test";
import { loginDemoAccount } from "./demo-auth";

test("catálogo repete a consulta depois de uma falha", async ({ page }) => {
  let attempts = 0;
  let failed = true;
  let successfulAttempts = 0;
  await page.route("**/api/catalog?**", async (route) => {
    attempts += 1;
    if (!failed) successfulAttempts += 1;
    await route.fulfill({
      status: failed ? 503 : 200,
      json: failed ? { message: "Indisponível" } : {
        products: [], total: 0, page: 1, pageSize: 12,
        facets: { categories: [], collections: [], colors: [], sizes: [],
          price: { min: 0, max: 0 }, promotionCount: 0, inStockCount: 0, newestCount: 0 }
      }
    });
  });
  await page.goto("/produtos");
  const retry = page.getByRole("button", { name: "Tentar novamente", exact: true });
  await expect(retry).toBeVisible();
  failed = false;
  await retry.click();
  await expect(retry).toHaveCount(0);
  expect(attempts).toBeGreaterThanOrEqual(2);
  expect(successfulAttempts).toBe(1);
});

test("atendimento informa falha inicial e permite consultar novamente", async ({ page }) => {
  let failed = true;
  await page.route("**/api/support", (route) => route.fulfill({
    status: failed ? 503 : 401,
    json: failed ? { ok: false } : { ok: false, requiresAuthentication: true }
  }));
  await page.goto("/ajuda");
  const support = page.locator(".customer-support");
  await expect(support.getByRole("alert")).toContainText("Não foi possível carregar os atendimentos");
  await expect(support.getByText("Nenhum chamado aberto")).toHaveCount(0);
  failed = false;
  await support.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(support.getByRole("alert")).toHaveCount(0);
  await support.getByRole("button", { name: "Novo chamado", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=/u, { timeout: 30_000 });
});

test("cliente mantém endereço preenchido em falha e bloqueia reenvio", async ({ page }) => {
  await loginDemoAccount(page, "cliente.demo@curtiz.local");
  await page.goto("/minha-conta/enderecos");
  await page.getByRole("button", { name: "Adicionar endereço", exact: true }).click();
  const form = page.locator("form.customer-form");
  await form.getByLabel("Destinatário", { exact: true }).fill("Cliente Teste");
  await form.getByLabel("CEP", { exact: true }).fill("30110-000");
  await form.getByLabel("Rua / avenida", { exact: true }).fill("Rua de Teste");
  await form.locator('[name="number"]').fill("10");
  await form.locator('[name="district"]').fill("Centro");
  await form.locator('[name="city"]').fill("Belo Horizonte");
  await form.locator('[name="state"]').fill("MG");
  let attempts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/customer", async (route) => {
    attempts += 1;
    await gate;
    await route.abort("failed");
  });
  const save = form.getByRole("button", { name: "Salvar endereço", exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  await form.evaluate((element) => (element as HTMLFormElement).requestSubmit());
  release();
  await expect(page.getByRole("alert").filter({ hasText: "Não conseguimos confirmar" })).toBeVisible();
  await expect(form.locator('[name="street"]')).toHaveValue("Rua de Teste");
  await expect(save).toBeEnabled();
  expect(attempts).toBe(1);
});
