import type { Product } from "@curtiz/domain";
import { describe, expect, it } from "vitest";
import { appendEligibleRecommendations, loadRecommendationFallback } from "./recommendation-fallback";

const product = (id: string, overrides: Partial<Product> = {}): Product => ({
  id, slug: id, name: id, category: "Chinelos", description: "Produto",
  priceInCents: 5000, rating: 0, reviews: 0, colors: ["Preto"], sizes: ["37"],
  image: `${id}.webp`, featured: false, stock: 1, ...overrides
});

describe("fallback de recomendações", () => {
  it("exclui o produto atual, indisponíveis, sem foto e IDs repetidos", () => {
    const current = product("current");
    const valid = product("valid");
    expect(appendEligibleRecommendations([], [current, valid, valid,
      product("sold-out", { stock: 0 }), product("no-image", { image: "" })],
    new Set([current.id]), 8)).toEqual([valid]);
  });

  it("continua após falha da fonte principal e completa com catálogos reais elegíveis", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const result = await loadRecommendationFallback({
      initial: [], excludedIds: ["current"], category: "chinelos", priceInCents: 5000,
      limit: 2, signal: controller.signal,
      fetcher: async (url) => {
        calls.push(url);
        if (calls.length === 1) throw new Error("recommendations unavailable");
        if (calls.length === 2) return { ok: true, json: async () => ({ products: [
          product("current"), product("one"), product("one"), product("sold-out", { stock: 0 })
        ] }) };
        return { ok: true, json: async () => ({ products: [product("two")] }) };
      }
    });
    expect(result.map((item) => item.id)).toEqual(["one", "two"]);
    expect(calls[0]).toContain("source=trending");
    expect(calls[0]).toContain("category=chinelos");
    expect(calls[1]).toContain("preco_min=");
    expect(calls).toHaveLength(3);
  });
});
