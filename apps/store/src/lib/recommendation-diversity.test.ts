import type { Product } from "@curtiz/domain";
import { describe, expect, it } from "vitest";
import { diversifyRecommendations } from "./recommendation-diversity";

const product = (id: string, overrides: Partial<Product> = {}): Product => ({
  id, slug: id, name: `Sandália ${id}`, category: "Sandálias", description: "Para o dia a dia",
  priceInCents: 5990, rating: 0, reviews: 0, colors: [], sizes: [],
  image: `/catalog-public/${id}.webp`, imagePath: `${id}.webp`, stock: 2, ...overrides
});

const current = product("A", { name: "Kit chinelo Branco", modelSlug: "kit-chinelo" });
const options = { currentProduct: current, limit: 6, mode: "product_detail" as const };

describe("diversidade de recomendações", () => {
  it("remove todas as variantes do produto atual, deduplica IDs e preserva famílias diferentes", () => {
    const candidates = [
      product("A", { name: "Kit chinelo Branco", variantColor: "Branco", variantId: "a-white" }),
      product("A", { name: "Kit chinelo Preto", variantColor: "Preto", variantId: "a-black" }),
      product("B", { name: "Kit chinelo Branco", modelSlug: "kit-b", variantId: "b-white" }),
      product("B", { name: "Kit chinelo Preto", modelSlug: "kit-b", variantId: "b-black" }),
      product("C", { name: "Chinelo estampado", modelSlug: "estampado" }),
      product("D", { name: "Sandália com strass", modelSlug: "strass" }),
      product("E", { name: "Slide praia", modelSlug: "praia" })
    ];

    const result = diversifyRecommendations(candidates, options);
    expect(result.map((item) => item.id)).toEqual(["B", "C", "D", "E"]);
    expect(result.some((item) => item.id === current.id)).toBe(false);
    expect(new Set(result.map((item) => item.id)).size).toBe(result.length);
  });

  it("mantém somente um registro com a mesma identidade externa", () => {
    const result = diversifyRecommendations([
      product("import-1", { recommendationIdentity: "source-key-hash", modelSlug: "first" }),
      product("import-2", { recommendationIdentity: "source-key-hash", modelSlug: "second" }),
      product("independent", { modelSlug: "independent" })
    ], { ...options, limit: 3 });

    expect(result.map((item) => item.id)).toEqual(["import-1", "independent"]);
  });

  it("prefere imagens diferentes antes de repetir uma imagem", () => {
    const candidates = [
      ...Array.from({ length: 6 }, (_, index) => product(`same-${index}`, {
        name: `Modelo visual ${index}`, modelSlug: `same-${index}`, image: "/catalog-public/shared.webp",
        imagePath: "shared.webp"
      })),
      product("different-1", { name: "Modelo visual sete", modelSlug: "different-1", imagePath: "unique-1.webp" }),
      product("different-2", { name: "Modelo visual oito", modelSlug: "different-2", imagePath: "unique-2.webp" })
    ];

    const result = diversifyRecommendations(candidates, { ...options, limit: 3, relaxFamilies: true });
    expect(result).toHaveLength(3);
    expect(result.slice(0, 2).map((item) => item.id)).toEqual(["different-1", "different-2"]);
    expect(new Set(result.slice(0, 2).map((item) => item.imagePath)).size).toBe(2);
  });

  it("trata a cor como sinal secundário e intercala opções de cores diferentes", () => {
    const result = diversifyRecommendations([
      product("white-1", { name: "Slide clássico Branco", modelSlug: "model-1", variantColor: "Branco", colors: ["Branco"] }),
      product("white-2", { name: "Slide clássico Branco", modelSlug: "model-2", variantColor: "Branco", colors: ["Branco"] }),
      product("pink", { name: "Slide estampado Rosa", modelSlug: "model-3", variantColor: "Rosa", colors: ["Rosa"] }),
      product("blue", { name: "Slide praia Azul", modelSlug: "model-4", variantColor: "Azul", colors: ["Azul"] })
    ], { ...options, limit: 3 });

    expect(result.map((item) => item.id)).toEqual(["white-1", "pink", "blue"]);
  });

  it("relaxa o limite de família quando só restam candidatos próximos sem incluir o produto aberto", () => {
    const result = diversifyRecommendations([
      product("A", { name: current.name, modelSlug: current.modelSlug }),
      product("close-1", { name: "Kit chinelo Preto", modelSlug: "kit-chinelo" }),
      product("close-2", { name: "Kit chinelo Lilás", modelSlug: "kit-chinelo" }),
      product("close-3", { name: "Kit chinelo Azul", modelSlug: "kit-chinelo" })
    ], { ...options, limit: 4, relaxFamilies: true });

    expect(result.map((item) => item.id)).toEqual(["close-1", "close-2", "close-3"]);
    expect(result.some((item) => item.id === current.id)).toBe(false);
  });
});
