export type ProductImportQueueResult = {
  productKey: string;
  ok: boolean;
  alreadyImported?: boolean;
  warnings?: string[];
  message: string;
};

export type ProductImportBatchResult = ProductImportQueueResult & {
  hasMore?: boolean;
  nextImageOffset?: number;
  retryable?: boolean;
};

export async function runProductImportBatches(
  productKey: string,
  importBatch: (imageOffset: number) => Promise<ProductImportBatchResult>,
  pauseBetweenBatchesMs = 650,
  retryDelayBaseMs = 700
): Promise<ProductImportQueueResult> {
  let imageOffset = 0;
  let firstRequest = true;
  let initiallyImported = false;
  const warnings = new Set<string>();
  for (let batch = 0; batch < 501; batch += 1) {
    let result: ProductImportBatchResult | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await importBatch(imageOffset);
        if (result.ok || !result.retryable) break;
      } catch (error) {
        lastError = error;
      }
      if (attempt < 2 && retryDelayBaseMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayBaseMs * (attempt + 1)));
    }
    if (!result) throw lastError instanceof Error ? lastError : new Error("Falha de conexão durante a importação.");
    if (!result.ok) return { ...result, warnings: [...warnings, ...(result.warnings ?? [])] };
    if (firstRequest) initiallyImported = result.alreadyImported === true;
    firstRequest = false;
    for (const warning of result.warnings ?? []) warnings.add(warning);
    if (!result.hasMore) {
      return {
        productKey,
        ok: true,
        alreadyImported: initiallyImported,
        warnings: [...warnings],
        message: initiallyImported
          ? "Produto já importado; imagens pendentes foram reconciliadas."
          : warnings.size ? "Produto importado com avisos." : "Produto importado."
      };
    }
    const next = result.nextImageOffset;
    if (!Number.isInteger(next) || next === undefined || next <= imageOffset) {
      return { productKey, ok: false, warnings: [...warnings], message: "A importação recebeu um progresso de imagens inválido." };
    }
    imageOffset = next;
    if (pauseBetweenBatchesMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseBetweenBatchesMs));
  }
  return { productKey, ok: false, warnings: [...warnings], message: "A importação excedeu o limite de lotes de imagens." };
}

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
