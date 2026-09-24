import type { Product } from "@curtiz/domain";
import { describe, expect, it } from "vitest";
import { loadSmartRecommendations, searchContextScore } from "./smart-recommendations";

const product = (id: string, overrides: Partial<Product> = {}): Product => ({
  id, slug: id, name: `Sandália ${id}`, category: "Sandálias", description: "Para o dia a dia",
  priceInCents: 5990, rating: 0, reviews: 0, colors: [], sizes: [],
  image: `https://cdn.test/products/${id}.webp`, stock: 2, ...overrides
});
const reply = (products: Product[]) => Response.json({ products, source: "personalized", nextCursor: null });
const urlOf = (input: RequestInfo | URL) => typeof input === "string" ? input
  : input instanceof URL ? input.href : input.url;
const bodyOf = (body: BodyInit | null | undefined) => typeof body === "string" ? body : "";
const options = (signal = new AbortController().signal) => ({
  source: "personalized" as const, sessionId: null as string | null, limit: 3, signal
});

describe("recomendações inteligentes", () => {
  it("prioriza o perfil consentido e só busca contexto quando faltam produtos", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = urlOf(input);
      calls.push({ url, init });
      return url.includes("/api/catalog")
        ? Response.json({ products: [product("strass", { name: "Sandália com strass" }), product("lisa", { name: "Lisa", category: "Chinelos" })] })
        : reply([product("perfil-1", { name: "Sandália strass" }), product("perfil-2")]);
    };
    const result = await loadSmartRecommendations({ ...options(), sessionId: "session-id", query: "strass",
      fetcher });
    expect(calls[0]?.url).toBe("/api/intelligence/recommendations");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(bodyOf(calls[0]?.init?.body))).toMatchObject({ source: "personalized", seed: "strass" });
    expect(calls[1]?.url).toContain("/api/catalog?");
    expect(result.products.map((item) => item.id)).toEqual(["perfil-1", "perfil-2", "strass"]);
    expect(calls).toHaveLength(2);
  });

  it("sem consentimento usa apenas contexto público e aproxima prefixos reais", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(urlOf(input));
      return Response.json({ products: [
        product("chinelos", { name: "Chinelo liso", category: "Chinelos" }),
        product("sandalias", { name: "Slide", category: "Sandálias" })
      ] });
    };
    const result = await loadSmartRecommendations({ ...options(), limit: 1, query: "sand", fetcher });
    expect(result.products.map((item) => item.id)).toEqual(["sandalias"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/catalog?");
    expect(searchContextScore(product("praia", { description: "Ideal para praia" }), "praia")).toBeGreaterThan(0);
    expect(searchContextScore(product("liso", { name: "Chinelo liso", category: "Chinelos" }), "strass")).toBe(0);
  });

  it("usa preenchimento apenas quando necessário e remove variantes, indisponíveis e logos", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = urlOf(input);
      calls.push(url);
      return url === "/api/intelligence/recommendations"
        ? reply([product("a"), product("a", { variantId: "other" }), product("logo", { image: "/images/logo.svg" })])
        : Response.json({ products: [product("a"), product("b"), product("c", { stock: 0 }), product("d")] });
    };
    const result = await loadSmartRecommendations({ ...options(), sessionId: "session-id", fetcher });
    expect(result.products.map((item) => item.id)).toEqual(["a", "b", "d"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("source=most_wanted");
  });

  it("exclui o produto atual e aplica categoria e preço no contexto do produto", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = urlOf(input);
      calls.push({ url, init });
      return url === "/api/intelligence/recommendations"
        ? reply([product("00000000-0000-4000-8000-00000000000a"), product("similar")])
        : Response.json({ products: [product("similar"), product("other")] });
    };
    const result = await loadSmartRecommendations({ ...options(), sessionId: "session-id",
      productId: "00000000-0000-4000-8000-00000000000a", category: "Sandálias", priceInCents: 6000, limit: 2, fetcher });
    expect(result.products.map((item) => item.id)).toEqual(["similar", "other"]);
    const primary = JSON.parse(bodyOf(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(primary).toMatchObject({
      category: "Sandálias", priceMin: 3900, priceMax: 8100,
      seen: ["00000000-0000-4000-8000-00000000000a"]
    });
    expect(calls[1]?.url).toContain("/api/catalog?");
    expect(calls[1]?.url).toContain("preco_min=39");
    expect(calls[1]?.url).toContain("preco_max=81");
  });

  it("sem sessão prioriza o modelo atual dentro da categoria pública", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(urlOf(input));
      return Response.json({ products: [
        product("other", { name: "Sandália lisa" }),
        product("current", { name: "Slide Wave" }),
        product("similar", { name: "Slide Wave Azul" })
      ] });
    };
    const result = await loadSmartRecommendations({ ...options(), productId: "current",
      productName: "Slide Wave", category: "Sandálias", limit: 2, fetcher });
    expect(result.products.map((item) => item.id)).toEqual(["similar", "other"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/catalog?");
  });

  it("prioriza contexto antes de sinais comportamentais e deduplica cores", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = urlOf(input);
      const source = init?.body ? (JSON.parse(bodyOf(init.body)) as { source: string }).source
        : new URL(url, "https://store.example").searchParams.get("source") ?? "context";
      calls.push(source);
      if (source === "context") return Response.json({ products: [
        product("color-1", { name: "Sandália Lilás" }),
        product("color-1", { name: "Sandália Lilás 2", variantId: "other" })
      ] });
      if (source === "personalized") return reply([product("profile")]);
      if (source === "because_you_viewed") return reply([product("related")]);
      return reply([]);
    };
    const result = await loadSmartRecommendations({ ...options(), limit: 3,
      sessionId: "consented", query: "sandália", recent: ["a"], fetcher });
    expect(calls).toEqual(["personalized", "context", "because_you_viewed"]);
    expect(result.products.map((item) => item.id)).toEqual(["profile", "color-1", "related"]);
  });

  it("sem consentimento não solicita faixa de preço comportamental", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(urlOf(input));
      return Response.json({ products: [product("public")], source: "public" });
    };
    await loadSmartRecommendations({ ...options(), limit: 1, priceInCents: 6000, fetcher });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/catalog?");
  });

  it("preserva a fonte Novidades e não consulta após cancelamento", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(urlOf(input));
      return Response.json({ products: [product("new")] });
    };
    await loadSmartRecommendations({ ...options(), source: "newest", sessionId: "session-id", fetcher });
    expect(calls[0]).toContain("source=newest");
    const controller = new AbortController();
    controller.abort();
    expect((await loadSmartRecommendations({ ...options(controller.signal), fetcher })).products).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
