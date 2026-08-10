import { describe, expect, it } from "vitest";
import { publicCatalogMediaUrl } from "./public-media";

describe("publicCatalogMediaUrl", () => {
  it("aponta midias iniciais para a loja publica", () => {
    expect(
      publicCatalogMediaUrl("/images/products/wave-preto.png", {
        storeUrl: "https://loja.curtiz.test"
      })
    ).toBe("https://loja.curtiz.test/images/products/wave-preto.png");
  });

  it("preserva URLs HTTPS e resolve arquivos do Storage", () => {
    expect(
      publicCatalogMediaUrl("https://cdn.curtiz.test/produto.webp", {})
    ).toBe("https://cdn.curtiz.test/produto.webp");
    expect(
      publicCatalogMediaUrl("products/produto.webp", {
        supabaseUrl: "https://project.supabase.co/"
      })
    ).toBe(
      "https://project.supabase.co/storage/v1/object/public/catalog-public/products/produto.webp"
    );
  });
});
