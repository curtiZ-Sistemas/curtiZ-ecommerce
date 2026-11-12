type RecordRow = Record<string, unknown>;
type ReadProfits = (ids: string[]) => PromiseLike<{ data: unknown; error: unknown }>;

export async function attachManagerOrderProfits(rows: RecordRow[], read: ReadProfits): Promise<RecordRow[]> {
  if (!rows.length) return rows;
  const ids = rows.map((row) => {
    if (typeof row.id !== "string" || !row.id) throw new Error("Invalid order ID");
    return row.id;
  });
  const profits = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 500) {
    const result = await read(ids.slice(i, i + 500));
    if (result.error || !Array.isArray(result.data)) throw new Error("Order profits unavailable");
    for (const value of result.data as unknown[]) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid order profit");
      const row = value as RecordRow;
      if (typeof row.order_id !== "string" || typeof row.estimated_profit !== "number" || !Number.isFinite(row.estimated_profit) || profits.has(row.order_id)) {
        throw new Error("Invalid order profit");
      }
      profits.set(row.order_id, row.estimated_profit);
    }
  }
  return rows.map((row) => {
    const profit = profits.get(row.id as string);
    if (profit === undefined) throw new Error("Missing order profit");
    return { ...row, estimated_profit: profit };
  });
}
