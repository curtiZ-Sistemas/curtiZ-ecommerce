import { createHash } from "node:crypto";
import { logServerEvent, postgresUuidSchema, readJsonResponse } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest, privateNoStore, safePanelOrigin, unauthorizedAdminResponse } from "@/lib/admin-api";
import { prepareProductImportImages } from "@/lib/product-import-images";
import { enqueueProductImportImages } from "@/lib/product-import-queue";
import { automaticProductSeo } from "@/lib/product-management";
import { parseProductImportSessionPayload, productImportTaxonomySlug } from "@/lib/product-import-session";

export const runtime = "nodejs";

const requestSchema = z.object({
  sessionId: postgresUuidSchema,
  productKey: z.string().trim().min(1).max(120),
  imageOffset: z.number().int().min(-1).max(1_000).optional()
}).strict();
const text = (value: unknown) => typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type ImportStage = "session" | "save_product" | "images";

const databaseFailure = (code: string, internalMessage = "") => {
  if (code === "42501") return { code: "PERMISSION_DENIED", message: "Seu acesso não permite concluir esta importação.", status: 403, retryable: false };
  if (code === "23505") return { code: "DUPLICATE_PRODUCT", message: "Já existe um produto, slug ou SKU igual no catálogo.", status: 409, retryable: false };
  if (code === "23503") return { code: "MISSING_RELATION", message: "Uma categoria, coleção, modelo ou vínculo informado não existe mais.", status: 409, retryable: false };
  if (code === "P0002") return { code: "TAXONOMY_NOT_FOUND", message: "A categoria ou o modelo informado não existe e a criação automática está desativada.", status: 409, retryable: false };
  if (["22023", "22P02", "23514"].includes(code)) return { code: "INVALID_PRODUCT_DATA", message: "Os dados deste produto não atendem às regras do catálogo.", status: 409, retryable: false };
  if (["42703", "42883", "42P01", "PGRST202", "PGRST204", "PGRST205"].includes(code)
      || (code === "54000" && internalMessage.toLocaleLowerCase("en-US").includes("null character"))) {
    return { code: "IMPORT_SCHEMA_UNAVAILABLE", message: "A migration do importador ainda não está disponível no banco.", status: 503, retryable: false };
  }
  const retryable = ["53300", "57014", "57P03", "08000", "08001", "08003", "08004", "08006", "PGRST000", "PGRST001", "PGRST002"].includes(code);
  return { code: retryable ? "IMPORT_TEMPORARILY_UNAVAILABLE" : "IMPORT_INTERNAL_ERROR", message: retryable
    ? "O serviço de importação está temporariamente indisponível. Tente novamente."
    : "Não foi possível concluir esta etapa da importação.", status: retryable ? 503 : 500, retryable };
};

function errorResponse(requestId: string, stage: ImportStage, failure: { code: string; message: string; status: number; retryable: boolean }) {
  return NextResponse.json({ message: failure.message, requestId, stage, code: failure.code, retryable: failure.retryable }, { status: failure.status, headers: privateNoStore });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (!safePanelOrigin(request)) return errorResponse(requestId, "session", { code: "ORIGIN_NOT_ALLOWED", message: "Origem não permitida.", status: 403, retryable: false });
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse(request);
  const permissions = await Promise.all(["products.create", "products.update", "inventory.adjust"].map((permissionCode) => auth.supabase.rpc("has_permission", { permission_code: permissionCode })));
  if (permissions.some((permission) => permission.error || permission.data !== true)) return errorResponse(requestId, "session", { code: "PERMISSION_DENIED", message: "Seu acesso não permite importar produtos.", status: 403, retryable: false });
  const body = await readJsonResponse(request, 8_192);
  if (body instanceof Response) return body;
  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) return errorResponse(requestId, "session", { code: "INVALID_IMPORT_REQUEST", message: "Sessão ou produto de importação inválido.", status: 400, retryable: false });

  const { sessionId, productKey } = parsedRequest.data;
  let stage: ImportStage = "session";
  try {
    const session = await auth.supabase.from("product_import_sessions").select("payload,batch_hash")
      .eq("id", sessionId).eq("user_id", auth.userId).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (session.error) return errorResponse(requestId, stage, databaseFailure(session.error.code ?? "SESSION_LOOKUP_FAILED", session.error.message));
    if (!session.data) return errorResponse(requestId, stage, { code: "SESSION_EXPIRED", message: "A sessão de importação expirou. Selecione a planilha novamente.", status: 410, retryable: false });

    let sessionPayload;
    try { sessionPayload = parseProductImportSessionPayload(session.data.payload); }
    catch { return errorResponse(requestId, stage, { code: "INVALID_SESSION", message: "A sessão de importação é inválida. Selecione a planilha novamente.", status: 409, retryable: false }); }
    const product = sessionPayload.batch.products.find((item) => item.key === productKey);
    if (!product) return errorResponse(requestId, stage, { code: "PRODUCT_NOT_IN_SESSION", message: "Produto não encontrado na sessão.", status: 404, retryable: false });
    const productError = product.issues.find((issue) => issue.level === "error");
    if (productError) return errorResponse(requestId, stage, { code: productError.code || "INVALID_PRODUCT_DATA", message: productError.message, status: 409, retryable: false });

    const reference = sessionPayload.references[product.key];
    const source = product.source.toLocaleLowerCase("pt-BR");
    const productWarnings = product.issues.filter((issue) => issue.level === "warning").map((issue) => issue.message);
    stage = "save_product";
    const seo = automaticProductSeo({ name: product.name, description: product.description, categoryName: product.categoryName });
    const saved = await auth.supabase.rpc("admin_import_product_with_taxonomy_authorized", {
      p_source: source, p_external_key: product.shopeeId || product.key, p_batch_hash: text(session.data.batch_hash),
      p_payload: {
        name: product.name, slug: product.slug, shortDescription: product.shortDescription, description: product.description,
        collectionId: reference?.collectionId ?? null, status: "draft", featured: product.featured,
        priceInCents: product.priceInCents, compareAtPriceInCents: product.compareAtPriceInCents, costInCents: product.costInCents,
        weightGrams: product.weightGrams, heightCm: product.heightCm, widthCm: product.widthCm, lengthCm: product.lengthCm,
        seoTitle: seo.title, seoDescription: seo.description, merchantCondition: product.merchantCondition,
        merchantGender: product.merchantGender, merchantAgeGroup: product.merchantAgeGroup,
        googleProductCategory: product.googleProductCategory, merchantIdentifierExists: product.merchantIdentifierExists,
        stockReason: "Estoque definido pela importação de produtos",
        variants: product.variants.map((variant) => ({ sku: variant.sku, color: variant.color, colorHex: variant.colorHex,
          colorHexSecondary: variant.colorHexSecondary, size: variant.size, priceInCents: variant.priceInCents,
          costInCents: variant.costInCents, stock: variant.stock, active: variant.active, gtin: variant.gtin, mpn: variant.mpn })),
        sizeGuide: product.sizeGuide, specifications: product.specifications
      },
      p_category_name: product.categoryName, p_category_slug: productImportTaxonomySlug(product.categoryName),
      p_create_category: sessionPayload.batch.options.createCategoryIfMissing, p_model_name: product.modelName || null,
      p_model_slug: product.modelName ? productImportTaxonomySlug(product.modelName) : null,
      p_create_model: sessionPayload.batch.options.createModelIfMissing
    });
    const savedData = record(saved.data);
    const productId = text(savedData.productId);
    if (saved.error || !productId) {
      logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: saved.error?.code ?? "INVALID_RESULT", productKey });
      return errorResponse(requestId, stage, databaseFailure(saved.error?.code ?? "INVALID_RESULT", saved.error?.message));
    }

    stage = "images";
    const prepared = prepareProductImportImages(product.images);
    const hasExplicitPrimary = prepared.images.some((image) => image.primary);
    const imageJobs = prepared.images.map((image, index) => ({
      sourceUrl: image.url, normalizedUrl: image.normalizedUrl,
      storagePath: `products/imports/${productId}/${createHash("sha256").update(image.normalizedUrl).digest("hex")}.webp`,
      colorName: image.color || null, sortOrder: image.order,
      isPrimary: image.primary || (!hasExplicitPrimary && index === 0), applyAllSizes: image.applyAllSizes
    }));
    const enqueued = await auth.supabase.rpc("admin_enqueue_product_import_images", { p_run_id: sessionId, p_product_id: productId, p_images: imageJobs });
    if (enqueued.error) return errorResponse(requestId, stage, databaseFailure(enqueued.error.code ?? "IMAGE_JOBS_FAILED", enqueued.error.message));
    const rawJobIds = record(enqueued.data).jobIds;
    const jobIds = Array.isArray(rawJobIds) ? rawJobIds.filter((id): id is string => postgresUuidSchema.safeParse(id).success) : [];
    try { await enqueueProductImportImages(jobIds.map((jobId) => ({ jobId, runId: sessionId, productId }))); }
    catch {
      logServerEvent("error", "panel_product_import_queue_failed", { requestId, stage, code: "QUEUE_UNAVAILABLE", productKey, productId });
      return errorResponse(requestId, stage, { code: "IMPORT_QUEUE_UNAVAILABLE", message: "Os produtos foram salvos, mas a fila de imagens está temporariamente indisponível. Tente novamente.", status: 503, retryable: true });
    }

    return NextResponse.json({
      ok: true, productId, productKey, alreadyImported: savedData.alreadyImported === true,
      importedImages: prepared.images.length - jobIds.length, expectedImages: prepared.images.length, queuedImages: jobIds.length,
      warnings: [...productWarnings, ...prepared.warnings], hasMore: false, imageFailures: false,
      requestId, stage, code: "IMAGES_QUEUED", retryable: false,
      message: jobIds.length ? "Produto salvo como rascunho. As imagens continuarão em segundo plano." : "Produto e imagens já estavam importados."
    }, { headers: privateNoStore });
  } catch (error) {
    logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: error instanceof Error ? error.message.slice(0, 80) : "unknown", productKey });
    return errorResponse(requestId, stage, databaseFailure(error instanceof Error ? error.message : "UNKNOWN"));
  }
}
