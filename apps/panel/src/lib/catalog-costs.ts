type CatalogProduct = {
  id: string;
  costInCents: number;
  variants: Array<{ id: string; costInCents: number | null }>;
};

type ReadCosts = (ids: string[]) => PromiseLike<{ data: unknown; error: unknown }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const cents = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Invalid catalog cost");
  }
  return Math.round(value * 100);
};

/** Attach costs only after the protected reader confirms every returned item. */
export async function attachCatalogCosts<T extends CatalogProduct>(products: T[], read: ReadCosts): Promise<T[]> {
  if (!products.length) return products;
  const results: unknown[] = [];
  for (let i = 0; i < products.length; i += 500) {
    const response = await read(products.slice(i, i + 500).map((item) => item.id));
    if (response.error || !Array.isArray(response.data)) throw new Error("Catalog costs unavailable");
    for (const row of response.data as unknown[]) results.push(row);
  }
  const costs = new Map<string, Record<string, unknown>>();
  for (const row of results) {
    if (!isRecord(row) || typeof row.product_id !== "string" || !Object.hasOwn(row, "product_cost") || !isRecord(row.variants) || costs.has(row.product_id)) {
      throw new Error("Invalid catalog costs");
    }
    costs.set(row.product_id, row);
  }
  return products.map((product) => {
    const cost = costs.get(product.id);
    if (!cost || !isRecord(cost.variants)) throw new Error("Missing catalog cost");
    const variants = cost.variants;
    return {
      ...product,
      costInCents: cost.product_cost === null ? 0 : cents(cost.product_cost),
      variants: product.variants.map((variant) => {
        if (!Object.hasOwn(variants, variant.id)) throw new Error("Missing variant cost");
        const value = variants[variant.id];
        return { ...variant, costInCents: value === null ? null : cents(value) };
      })
    };
  });
}
