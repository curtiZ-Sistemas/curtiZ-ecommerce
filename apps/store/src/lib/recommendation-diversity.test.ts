import type { Product } from "@curtiz/domain";
import { describe, expect, it } from "vitest";
import { diversifyRecommendations } from "./recommendation-diversity";

const product = (id: string, overrides: Partial<Product> = {}): Product => ({
  id, slug: id, name: `Sandalia ${id}`, category: "Sandalias", description: "Para o dia a dia",
  priceInCents: 5990, rating: 0, reviews: 0, colors: [], sizes: [],
  image: `/catalog-public/${id}.webp`, imagePath: `${id}.webp`, stock: 2, ...overrides
});

const current = product("A", { name: "Kit chinelo Branco", modelSlug: "kit-chinelo" });
const options = { currentProduct: current, limit: 6, mode: "product_detail" as const };

describe("diversidade de recomendacoes", () => {
  it("remove variantes do produto atual, deduplica identidades e preserva familias distintas", () => {
    const candidates = [
      product("A", { name: "Kit chinelo Branco", variantColor: "Branco", variantId: "a-white" }),
      product("A", { name: "Kit chinelo Preto", variantColor: "Preto", variantId: "a-black" }),
      product("B", { name: "Kit 2 Sandalias com Pedraria Branco", modelSlug: "kit-b", variantId: "b-white" }),
      product("B", { name: "Kit 2 Sandalias com Pedraria Preto", modelSlug: "kit-b", variantId: "b-black" }),
      product("C", { name: "Chinelo estampado", modelSlug: "estampado" }),
      product("D", { name: "Sandalia com strass", modelSlug: "strass" }),
      product("E", { name: "Slide praia", modelSlug: "praia" })
    ];

    const result = diversifyRecommendations(candidates, options);
    expect(result.map((item) => item.id)).toEqual(["B", "C", "E", "D"]);
    expect(result.some((item) => item.id === current.id)).toBe(false);
    expect(new Set(result.map((item) => item.id)).size).toBe(result.length);
  });

  it("mantem somente um registro com a mesma identidade externa", () => {
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
        name: `Chinelo estampado ${["tropical", "floral", "geometrico", "abstrato", "animal", "listrado"][index]}`,
        modelSlug: `same-${index}`, image: "/catalog-public/shared.webp",
        imagePath: "shared.webp"
      })),
      product("different-1", { name: "Sandalia estampada tropical", modelSlug: "different-1", imagePath: "unique-1.webp" }),
      product("different-2", { name: "Slide liso classico", modelSlug: "different-2", imagePath: "unique-2.webp" })
    ];

    const result = diversifyRecommendations(candidates, { ...options, limit: 3 });
    expect(result).toHaveLength(3);
    expect(result.slice(0, 2).map((item) => item.id).sort()).toEqual(["different-1", "different-2"]);
    expect(new Set(result.slice(0, 2).map((item) => item.imagePath)).size).toBe(2);
  });

  it("trata a cor como sinal secundario e intercala opcoes de cores diferentes", () => {
    const result = diversifyRecommendations([
      product("white-1", { name: "Slide classico Branco", modelSlug: "model-1", variantColor: "Branco", colors: ["Branco"] }),
      product("white-2", { name: "Slide classico Branco", modelSlug: "model-2", variantColor: "Branco", colors: ["Branco"] }),
      product("pink", { name: "Slide estampado Rosa", modelSlug: "model-3", variantColor: "Rosa", colors: ["Rosa"] }),
      product("blue", { name: "Slide praia Azul", modelSlug: "model-4", variantColor: "Azul", colors: ["Azul"] })
    ], { ...options, limit: 3 });

    expect(result.map((item) => item.id)).toEqual(["white-1", "pink", "blue"]);
  });

  it("exclui a familia comercial atual sem relaxar para preencher o limite", () => {
    const result = diversifyRecommendations([
      product("A", { name: current.name, modelSlug: current.modelSlug }),
      product("close-1", { name: "Kit chinelo Preto", modelSlug: "kit-chinelo" }),
      product("close-2", { name: "Kit chinelo Lilas", modelSlug: "kit-chinelo" }),
      product("close-3", { name: "Kit chinelo Azul", modelSlug: "kit-chinelo" })
    ], { ...options, limit: 4 });

    expect(result).toEqual([]);
    expect(result.some((item) => item.id === current.id)).toBe(false);
  });

  it("prioriza outras experiencias no caso real do kit branco com strass", () => {
    const currentKit = product("current-kit", {
      name: "Kit 3 Chinelos Femininos Slim com Strass Branco",
      modelSlug: "kit-3-slim-strass",
      variantColor: "Branco"
    });
    const candidates = [
      product("A", { name: "Kit 2 Chinelos com Pedraria Branco Preto", modelSlug: "kit-pedraria-a" }),
      product("B", { name: "Kit 2 Chinelos com Pedraria Branco", modelSlug: "kit-pedraria-b" }),
      product("C", { name: "Kit 3 Chinelos Strass Branco", modelSlug: "kit-strass-c" }),
      product("D", { name: "Kit 2 Chinelos com Pedraria Branco", modelSlug: "kit-pedraria-d" }),
      product("E", { name: "Chinelo Estampado Tropical", modelSlug: "estampado-tropical" }),
      product("F", { name: "Chinelo Liso", modelSlug: "chinelo-liso" }),
      product("G", { name: "Chinelo Praia", modelSlug: "chinelo-praia" }),
      product("H", { name: "Chinelo Strass Unitario de outra linha", modelSlug: "strass-unitario" })
    ];

    const result = diversifyRecommendations(candidates, {
      currentProduct: currentKit, limit: 6, mode: "product_detail"
    });

    expect(result.map((item) => item.id)).toEqual(["E", "F", "G", "H"]);
    expect(result.filter((item) => ["A", "B", "C", "D"].includes(item.id)).length).toBeLessThanOrEqual(1);
  });

  it("mostra somente um item se todas as opcoes forem da mesma familia visual", () => {
    const result = diversifyRecommendations([
      product("A", { name: "Kit 2 Chinelos com Pedraria Branco Preto", modelSlug: "kit-a" }),
      product("B", { name: "Kit 2 Chinelos com Pedraria Branco", modelSlug: "kit-b" }),
      product("C", { name: "Kit 3 Chinelos Strass Branco", modelSlug: "kit-c" })
    ], { limit: 6, mode: "product_detail" });

    expect(result.map((item) => item.id)).toEqual(["A"]);
  });

  it("nao repete a mesma imagem para preencher o limite", () => {
    const result = diversifyRecommendations([
      product("same-a", { name: "Chinelo estampado tropical", modelSlug: "same-a", imagePath: "shared.webp" }),
      product("same-b", { name: "Chinelo estampado floral", modelSlug: "same-b", imagePath: "shared.webp" }),
      product("other", { name: "Sandalia lisa", modelSlug: "other", imagePath: "other.webp" })
    ], { limit: 3, mode: "product_detail" });

    expect(result).toHaveLength(2);
    expect(new Set(result.map((item) => item.imagePath)).size).toBe(2);
  });

  it("nao recomenda outro produto que use a imagem do produto aberto", () => {
    const currentProduct = product("current-image", {
      name: "Kit 2 Chinelos Slim", modelSlug: "kit-slim", imagePath: "current.webp"
    });
    const result = diversifyRecommendations([
      product("same-image", { name: "Chinelo estampado tropical", modelSlug: "estampado", imagePath: "current.webp" }),
      product("different-image", { name: "Sandalia lisa", modelSlug: "lisa", imagePath: "different.webp" })
    ], { currentProduct, limit: 3, mode: "product_detail" });

    expect(result.map((item) => item.id)).toEqual(["different-image"]);
  });
});
