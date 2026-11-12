type ReadCosts = (ids: string[]) => PromiseLike<{ data: unknown; error: unknown }>;

export async function readOperationalShipmentCosts(ids: string[], read: ReadCosts): Promise<Map<string, number | null>> {
  const unique = [...new Set(ids)];
  if (unique.some((id) => !id)) throw new Error("Invalid shipment ID");
  const costs = new Map<string, number | null>();
  for (let i = 0; i < unique.length; i += 500) {
    const result = await read(unique.slice(i, i + 500));
    if (result.error || !Array.isArray(result.data)) throw new Error("Shipment costs unavailable");
    for (const value of result.data as unknown[]) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid shipment cost");
      const row = value as Record<string, unknown>;
      if (typeof row.shipment_id !== "string" || costs.has(row.shipment_id) ||
          (row.shipping_cost !== null && (typeof row.shipping_cost !== "number" || !Number.isFinite(row.shipping_cost) || row.shipping_cost < 0))) {
        throw new Error("Invalid shipment cost");
      }
      costs.set(row.shipment_id, row.shipping_cost);
    }
  }
  if (unique.some((id) => !costs.has(id))) throw new Error("Missing shipment cost");
  return costs;
}
