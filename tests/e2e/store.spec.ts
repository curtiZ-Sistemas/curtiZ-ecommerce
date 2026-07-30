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

test("oferece um único acesso para clientes e equipe", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Acesse sua conta" })).toBeVisible();
  await expect(page.getByText(/Clientes? (ou|e) equipe Curtiz/i).filter({ visible: true })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Cadastre-se" })).toHaveAttribute(
    "href",
    "/cadastro"
  );
});

test("chat flutuante responde em modo mock e pode ser minimizado", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Abrir ajuda" }).click();
  await expect(page.getByRole("dialog", { name: "Ajuda Curtiz" })).toBeVisible();
  await expect(page.getByText(/Respostas simuladas/i)).toBeVisible();

  await page.getByLabel("Digite sua mensagem").fill("Como rastrear meu pedido?");
  await page.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(page.getByText(/Minha conta › Pedidos/i)).toBeVisible();

  await page.getByRole("button", { name: "Minimizar conversa" }).click();
  await expect(page.getByRole("button", { name: "Expandir conversa" })).toBeVisible();
  await page.getByRole("button", { name: "Fechar conversa" }).click();
  await expect(page.getByRole("dialog", { name: "Ajuda Curtiz" })).toBeHidden();
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
          name: "Curtiz Flip-Flop Wave Preto",
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
  await expect(page.getByRole("heading", { name: "Curtiz Flip-Flop Wave Preto" })).toBeVisible();
  await expect(page.getByText("R$ 59,90").first()).toBeVisible();
});
