import { describe, expect, it, vi } from "vitest";
import { attachCatalogCosts } from "./catalog-costs";

describe("protected catalog costs", () => {
  const products = [{ id: "p1", costInCents: 0, variants: [{ id: "v1", costInCents: null }] }];
  it("attaches confirmed product and variant costs", async () => {
    const read = vi.fn(async () => ({ data: [{ product_id: "p1", product_cost: 12.5, variants: { v1: 8.25 } }], error: null }));
    expect(await attachCatalogCosts(products, read)).toEqual([{ id: "p1", costInCents: 1250, variants: [{ id: "v1", costInCents: 825 }] }]);
    expect(read).toHaveBeenCalledWith(["p1"]);
  });
  it("fails closed when a cost or variant is missing", async () => {
    await expect(attachCatalogCosts(products, async () => ({ data: [{ product_id: "p1", product_cost: 12, variants: {} }], error: null }))).rejects.toThrow();
    await expect(attachCatalogCosts(products, async () => ({ data: [], error: null }))).rejects.toThrow();
  });
  it("fails closed when the cost reader fails", async () => {
    await expect(attachCatalogCosts(products, async () => ({ data: null, error: new Error("unavailable") }))).rejects.toThrow();
  });
  it("preserves the existing handling of nullable product and variant costs", async () => {
    const read = async () => ({ data: [{ product_id: "p1", product_cost: null, variants: { v1: null } }], error: null });
    expect(await attachCatalogCosts(products, read)).toEqual(products);
  });
  it("batches large result sets without silently dropping costs", async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ id: `p${i}`, costInCents: 0, variants: [] }));
    const read = vi.fn(async (ids: string[]) => ({ data: ids.map((id) => ({ product_id: id, product_cost: 1, variants: {} })), error: null }));
    const result = await attachCatalogCosts(many, read);
    expect(read.mock.calls.map(([ids]) => ids.length)).toEqual([500, 1]);
    expect(result.every((product) => product.costInCents === 100)).toBe(true);
  });
});
