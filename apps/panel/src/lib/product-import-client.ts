export type ProductImportQueueResult = {
  productKey: string;
  ok: boolean;
  alreadyImported?: boolean;
  warnings?: string[];
  message: string;
};

export async function runProductImportQueue(
  productKeys: readonly string[],
  importOne: (productKey: string) => Promise<ProductImportQueueResult>,
  onProgress?: (results: ProductImportQueueResult[], percentage: number) => void
) {
  const results: ProductImportQueueResult[] = [];
  for (const [index, productKey] of productKeys.entries()) {
    try {
      results.push(await importOne(productKey));
    } catch {
      results.push({ productKey, ok: false, message: "Falha de conexão durante a importação." });
    }
    onProgress?.([...results], Math.round(((index + 1) / productKeys.length) * 100));
  }
  return results;
}
