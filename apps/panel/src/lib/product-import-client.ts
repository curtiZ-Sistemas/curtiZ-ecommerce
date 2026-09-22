export type ProductImportQueueResult = {
  productKey: string;
  ok: boolean;
  alreadyImported?: boolean;
  warnings?: string[];
  imageFailures?: boolean;
  stage?: "session" | "save_product" | "source" | "images";
  requestId?: string;
  code?: string;
  retryable?: boolean;
  queueStopped?: boolean;
  message: string;
};

export type ProductImportBatchResult = ProductImportQueueResult & {
  hasMore?: boolean;
  nextImageOffset?: number;
};

const GLOBAL_IMPORT_FAILURES = new Set([
  "IMPORT_SCHEMA_UNAVAILABLE",
  "IMPORT_TEMPORARILY_UNAVAILABLE",
  "INVALID_SESSION",
  "SESSION_EXPIRED",
  "ORIGIN_NOT_ALLOWED",
  "PERMISSION_DENIED",
  "UPSTREAM_UNAVAILABLE",
  "NETWORK_FAILURE"
]);

function stopsProductImportQueue(result: ProductImportQueueResult) {
  return !result.ok && (result.retryable === true || GLOBAL_IMPORT_FAILURES.has(result.code ?? ""));
}

export async function runProductImportBatches(
  productKey: string,
  importBatch: (imageOffset: number) => Promise<ProductImportBatchResult>,
  pauseBetweenBatchesMs = 650
): Promise<ProductImportQueueResult> {
  let imageOffset = -1;
  let firstRequest = true;
  let initiallyImported = false;
  let imageFailures = false;
  let stage: ProductImportQueueResult["stage"];
  let requestId: string | undefined;
  let code: string | undefined;
  let failureDiagnosticCaptured = false;
  const warnings = new Set<string>();
  for (let batch = 0; batch < 501; batch += 1) {
    const result = await importBatch(imageOffset);
    if (!result.ok) return { ...result, warnings: [...warnings, ...(result.warnings ?? [])] };
    if (firstRequest) initiallyImported = result.alreadyImported === true;
    firstRequest = false;
    const currentImageFailure = result.imageFailures === true;
    imageFailures ||= currentImageFailure;
    stage = result.stage ?? stage;
    if (currentImageFailure || !failureDiagnosticCaptured) {
      requestId = result.requestId ?? requestId;
      code = result.code ?? code;
    }
    failureDiagnosticCaptured ||= currentImageFailure;
    for (const warning of result.warnings ?? []) warnings.add(warning);
    if (!result.hasMore) {
      return {
        productKey,
        ok: true,
        alreadyImported: initiallyImported,
        warnings: [...warnings],
        imageFailures,
        stage,
        requestId,
        code,
        message: initiallyImported
          ? "Produto já importado; imagens pendentes foram reconciliadas."
          : warnings.size ? "Produto importado com avisos." : "Produto importado."
      };
    }
    const next = result.nextImageOffset;
    if (!Number.isInteger(next) || next === undefined || next <= imageOffset) {
      return { productKey, ok: false, warnings: [...warnings], imageFailures, stage, requestId, code: "INVALID_IMAGE_PROGRESS", message: "A importação recebeu um progresso de imagens inválido." };
    }
    imageOffset = next;
    if (pauseBetweenBatchesMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseBetweenBatchesMs));
  }
  return { productKey, ok: false, warnings: [...warnings], imageFailures, stage, requestId, code: "IMAGE_BATCH_LIMIT", message: "A importação excedeu o limite de lotes de imagens." };
}

export async function runProductImportQueue(
  productKeys: readonly string[],
  importOne: (productKey: string) => Promise<ProductImportQueueResult>,
  onProgress?: (results: ProductImportQueueResult[], percentage: number) => void
) {
  const results: ProductImportQueueResult[] = [];
  for (const [index, productKey] of productKeys.entries()) {
    let result: ProductImportQueueResult;
    try {
      result = await importOne(productKey);
    } catch {
      result = {
        productKey,
        ok: false,
        code: "NETWORK_FAILURE",
        message: "Falha de conexão durante a importação."
      };
    }
    if (stopsProductImportQueue(result)) result = { ...result, queueStopped: true };
    results.push(result);
    const stopped = result.queueStopped === true;
    onProgress?.([...results], stopped ? 100 : Math.round(((index + 1) / productKeys.length) * 100));
    if (stopped) break;
  }
  return results;
}
