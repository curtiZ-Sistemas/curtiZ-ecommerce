import { expect, test } from "@playwright/test";

test("navega da home ao produto e adiciona ao carrinho", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Conforto que combina/i })).toBeVisible();
  await page.getByRole("link", { name: "Curtiz Flip-Flop Wave Preto" }).first().click();
  await page.getByRole("button", { name: /Adicionar ao carrinho/i }).click();
  await expect(page.getByRole("button", { name: /Adicionado ao carrinho/i })).toBeVisible();
  await page.getByRole("link", { name: /Carrinho com 1 itens/i }).click();
  await expect(page.getByRole("heading", { name: "Meu carrinho" })).toBeVisible();
});

test("abre atendimento humano na fila administrativa", async ({ page }) => {
  await page.goto("/ajuda");
  await page.getByRole("button", { name: /Como funciona o frete/i }).click();
  await page.getByRole("button", { name: /Falar com um humano/i }).click();
  await expect(page.getByText(/fila do Administrador/i)).toBeVisible();
});
