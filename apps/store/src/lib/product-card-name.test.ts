import { describe, expect, it } from "vitest";
import { productCardName } from "./product-card-name";

describe("nome comercial de apresentação", () => {
  it("reduz o excesso sem mudar a origem", () => {
    const name = "Chinelo Feminino Slim Confortável Chinelo Strass Feminino Luxo Alto Padrão Oferta";
    expect(productCardName(name)).toBe("Slim Strass");
    expect(name).toContain("Chinelo Feminino");
  });
  it("preserva modelos curtos, cor e números", () => {
    expect(productCardName("curti Z Slide Soft Preto")).toBe("Slide Soft Preto");
    expect(productCardName("Slim 2 Branco")).toBe("Slim 2 Branco");
    expect(productCardName("Sandália Infantil")).toBe("Sandália Infantil");
  });
  it("não devolve nome vazio para títulos compostos apenas de descritores", () => {
    const name = "Chinelo Feminino Confortável Luxo Alto Padrão Oferta";
    expect(productCardName(name)).toBe(name);
  });
});
