import { describe, expect, it } from "vitest";
import { publicCatalogMediaOrigins, publicCatalogMediaUrl } from "./public-media";

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
      publicCatalogMediaUrl("https://project.supabase.co/produto.webp", {
        supabaseUrl: "https://project.supabase.co"
      })
    ).toBe("https://project.supabase.co/produto.webp");
    expect(
      publicCatalogMediaUrl("products/produto.webp", {
        supabaseUrl: "https://project.supabase.co/"
      })
    ).toBe(
      "https://project.supabase.co/storage/v1/object/public/catalog-public/products/produto.webp"
    );
  });

  it("rejeita URL absoluta fora das origens configuradas", () => {
    expect(
      publicCatalogMediaUrl("https://cdn-invalido.test/produto.webp", {
        storeUrl: "https://loja.curtiz.test",
        supabaseUrl: "https://project.supabase.co"
      })
    ).toBe("");
  });

  it("expõe somente as origens exatas usadas pelo catálogo", () => {
    expect(
      publicCatalogMediaOrigins({
        storeUrl: "https://loja.curtiz.test/produtos",
        supabaseUrl: "https://project.supabase.co/"
      })
    ).toEqual(["https://loja.curtiz.test", "https://project.supabase.co"]);
  });
});
