import { describe, expect, it } from "vitest";
import { groupRepresentativeKitProducts, readRepresentativeKitPage, representativeKitPriceRange } from "./representative-kit-catalog";

const variant = { variantId: "existing-variant", color: "White", size: "39",
  unitPriceInCents: 4345, pairsPerSku: 2, available: 49, imageUrl: "/kit.webp", imageAlt: "Kit branco" };
const product = { productId: "existing-product", name: "Existing kit", variants: [variant] };

describe("grouped representative kit catalog", () => {
  it("preserves each variant identity, price, pair count, stock and image in a product group", () => {
    const page = readRepresentativeKitPage({ items: [product], total: 1, nextOffset: null,
      colors: ["White"], sizes: ["39"] });
    expect(page.items).toEqual([product]);
    expect(page.items[0]?.variants[0]?.variantId).toBe("existing-variant");
    expect(readRepresentativeKitPage({ items: [{ ...product, variants: [{ ...variant, available: null }] }],
      total: 1, nextOffset: null, colors: ["White"], sizes: ["39"] }).items[0]?.variants[0]?.available).toBeNull();
  });

  it.each([
    {},
    { items: null, total: 0, nextOffset: null, colors: [], sizes: [] },
    { items: [{ ...product, variants: [] }], total: 0, nextOffset: null, colors: [], sizes: [] },
    { items: [{ ...product, variants: [{ ...variant, unitPriceInCents: "4345" }] }], total: 1, nextOffset: null, colors: [], sizes: [] },
    { items: [{ ...product, variants: [{ ...variant, available: -1 }] }], total: 1, nextOffset: null, colors: [], sizes: [] },
    { items: [{ ...product, variants: [{ ...variant, pairsPerSku: 1 }] }], total: 1, nextOffset: null, colors: [], sizes: [] },
    { items: [product], total: -1, nextOffset: null, colors: [], sizes: [] },
    { items: [product], total: 1, nextOffset: null, colors: "White", sizes: [] }
  ])("does not mask malformed catalog data as a successful empty response", value => {
    expect(() => readRepresentativeKitPage(value)).toThrow();
  });

  it("collapses repeated products and repeated variant ids into one card without inventing variants", () => {
    const black = { ...variant, variantId: "v-black", color: "Preto", size: "39", unitPriceInCents: 4500 };
    const blackBig = { ...black, variantId: "v-black-41", size: "41", unitPriceInCents: 5000 };
    const white = { ...variant, variantId: "v-white", color: "Branco", size: "39" };
    const page = readRepresentativeKitPage({ total: 1, nextOffset: null, colors: [], sizes: [], items: [
      { productId: "p1", name: "Kit Meia", variants: [black, white] },
      { productId: "p1", name: "Kit Meia", variants: [black, blackBig] },
      { productId: "p2", name: "kit  méia", variants: [{ ...white, variantId: "v-gray", color: "Cinza" }] }
    ] });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.variants.map(item => item.variantId)).toEqual(["v-black", "v-white", "v-black-41", "v-gray"]);
    expect(representativeKitPriceRange(page.items[0]?.variants ?? [])).toEqual({ min: 4345, max: 5000 });
  });

  it("keeps same-name products apart when their color and size would collide", () => {
    const first = { productId: "a", name: "Kit", variants: [{ ...variant, variantId: "va" }] };
    const second = { productId: "b", name: "Kit", variants: [{ ...variant, variantId: "vb" }] };
    expect(groupRepresentativeKitProducts([first, second])).toHaveLength(2);
  });
});
