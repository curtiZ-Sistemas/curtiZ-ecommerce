import { createHash } from "node:crypto";
import { logServerEvent, postgresUuidSchema, readJsonResponse } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest, objectRows, privateNoStore, safePanelOrigin, unauthorizedAdminResponse } from "@/lib/admin-api";
import { inspectCatalogImage } from "@/lib/catalog-image";
import { prepareUploadImage } from "@/lib/image-upload";
import { prepareProductImportImages } from "@/lib/product-import-images";
import { automaticProductSeo } from "@/lib/product-management";
import { isAllowedShopeeImageUrl, parseProductImportSessionPayload, productImportTaxonomySlug } from "@/lib/product-import-session";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_BATCH_SIZE = 2;
const requestSchema = z.object({
  sessionId: postgresUuidSchema,
  productKey: z.string().trim().min(1).max(120),
  imageOffset: z.number().int().min(-1).max(1_000)
}).strict();
const text = (value: unknown) => typeof value === "string" ? value : "";
const normalized = (value: unknown) => text(value).normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const mediaUnavailable = (error: { code?: string; message?: string } | null) =>
  ["42P01", "PGRST200", "PGRST204", "PGRST205"].includes(error?.code ?? "") || (error?.message ?? "").toLowerCase().includes("schema cache");
type ImportStage = "session" | "save_product" | "source" | "images";

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

function errorResponse(requestId: string, stage: ImportStage, failure: {
  code: string; message: string; status: number; retryable: boolean;
}) {
  return NextResponse.json({ message: failure.message, requestId, stage, code: failure.code, retryable: failure.retryable }, {
    status: failure.status,
    headers: privateNoStore
  });
}

async function readLimitedImageBody(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new Error("Imagem acima de 10 MB.");
  if (!response.body) throw new Error("Imagem sem conteúdo.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error("Imagem acima de 10 MB."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function downloadShopeeImage(source: string) {
  let url = source;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!isAllowedShopeeImageUrl(url)) throw new Error("Host de imagem não permitido.");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { accept: "image/avif,image/webp,image/png,image/jpeg" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirecionamento de imagem inválido.");
      url = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw new Error(`CDN respondeu ${response.status}.`);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error("Conteúdo remoto não é uma imagem permitida.");
    const original = await readLimitedImageBody(response);
    const info = inspectCatalogImage(original);
    if (!info || info.mime !== contentType || info.width < 1 || info.height < 1 || info.width > 12_000 || info.height > 12_000 || info.width * info.height > 40_000_000) {
      throw new Error("Conteúdo remoto não contém uma imagem válida.");
    }
    return { bytes: await prepareUploadImage(original, MAX_IMAGE_BYTES), width: info.width, height: info.height };
  }
  throw new Error("A imagem excedeu o limite de redirecionamentos.");
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (!safePanelOrigin(request)) return errorResponse(requestId, "session", {
    code: "ORIGIN_NOT_ALLOWED", message: "Origem não permitida.", status: 403, retryable: false
  });
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse(request);
  const permissions = await Promise.all(["products.create", "products.update", "inventory.adjust"].map((permissionCode) =>
    auth.supabase.rpc("has_permission", { permission_code: permissionCode })
  ));
  if (permissions.some((permission) => permission.error || permission.data !== true)) {
    return errorResponse(requestId, "session", {
      code: "PERMISSION_DENIED", message: "Seu acesso não permite importar produtos.", status: 403, retryable: false
    });
  }
  const body = await readJsonResponse(request, 8_192);
  if (body instanceof Response) return body;
  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) return errorResponse(requestId, "session", {
    code: "INVALID_IMPORT_REQUEST", message: "Sessão ou produto de importação inválido.", status: 400, retryable: false
  });

  const { sessionId, productKey, imageOffset } = parsedRequest.data;
  let stage: ImportStage = "session";
  try {
    const session = await auth.supabase.from("product_import_sessions").select("payload,batch_hash")
      .eq("id", sessionId).eq("user_id", auth.userId).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (session.error) {
      logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: session.error.code ?? "SESSION_LOOKUP_FAILED", productKey });
      return errorResponse(requestId, stage, databaseFailure(session.error.code ?? "SESSION_LOOKUP_FAILED", session.error.message));
    }
    if (!session.data) return errorResponse(requestId, stage, {
      code: "SESSION_EXPIRED", message: "A sessão de importação expirou. Selecione a planilha novamente.", status: 410, retryable: false
    });

    let sessionPayload;
    try {
      sessionPayload = parseProductImportSessionPayload(session.data.payload);
    } catch {
      logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: "INVALID_SESSION_PAYLOAD", productKey });
      return errorResponse(requestId, stage, {
        code: "INVALID_SESSION", message: "A sessão de importação é inválida. Selecione a planilha novamente.", status: 409, retryable: false
      });
    }
    const product = sessionPayload.batch.products.find((item) => item.key === productKey);
    if (!product) return errorResponse(requestId, stage, {
      code: "PRODUCT_NOT_IN_SESSION", message: "Produto não encontrado na sessão.", status: 404, retryable: false
    });
    const productError = product.issues.find((issue) => issue.level === "error");
    if (productError) return errorResponse(requestId, stage, {
      code: productError.code || "INVALID_PRODUCT_DATA", message: productError.message, status: 409, retryable: false
    });
    const reference = sessionPayload.references[product.key];
    const externalKey = product.shopeeId || product.key;
    const source = product.source.toLocaleLowerCase("pt-BR");
    const productWarnings = product.issues.filter((issue) => issue.level === "warning").map((issue) => issue.message);

    if (imageOffset === -1) {
      stage = "save_product";
      const seo = automaticProductSeo({ name: product.name, description: product.description, categoryName: product.categoryName });
      const payload = {
        name: product.name, slug: product.slug, shortDescription: product.shortDescription,
        description: product.description, collectionId: reference?.collectionId ?? null,
        status: "draft", featured: product.featured, priceInCents: product.priceInCents,
        compareAtPriceInCents: product.compareAtPriceInCents, costInCents: product.costInCents,
        weightGrams: product.weightGrams, heightCm: product.heightCm, widthCm: product.widthCm,
        lengthCm: product.lengthCm, seoTitle: seo.title, seoDescription: seo.description,
        merchantCondition: product.merchantCondition, merchantGender: product.merchantGender,
        merchantAgeGroup: product.merchantAgeGroup, googleProductCategory: product.googleProductCategory,
        merchantIdentifierExists: product.merchantIdentifierExists,
        stockReason: "Estoque definido pela importação de produtos",
        variants: product.variants.map((variant) => ({
          sku: variant.sku, color: variant.color, colorHex: variant.colorHex,
          colorHexSecondary: variant.colorHexSecondary, size: variant.size,
          priceInCents: variant.priceInCents, costInCents: variant.costInCents,
          stock: variant.stock, active: variant.active, gtin: variant.gtin, mpn: variant.mpn
        })),
        sizeGuide: product.sizeGuide,
        specifications: product.specifications
      };
      const saved = await auth.supabase.rpc("admin_import_product_with_taxonomy_authorized", {
        p_source: source, p_external_key: externalKey,
        p_batch_hash: text(session.data.batch_hash), p_payload: payload,
        p_category_name: product.categoryName,
        p_category_slug: productImportTaxonomySlug(product.categoryName),
        p_create_category: sessionPayload.batch.options.createCategoryIfMissing,
        p_model_name: product.modelName || null,
        p_model_slug: product.modelName ? productImportTaxonomySlug(product.modelName) : null,
        p_create_model: sessionPayload.batch.options.createModelIfMissing
      });
      const savedData = record(saved.data);
      const productId = text(savedData.productId);
      if (saved.error || !productId) {
        logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: saved.error?.code ?? "INVALID_RESULT", productKey });
        return errorResponse(requestId, stage, databaseFailure(saved.error?.code ?? "INVALID_RESULT", saved.error?.message));
      }
      return NextResponse.json({
        ok: true, productId, productKey, alreadyImported: savedData.alreadyImported === true,
        importedImages: 0, expectedImages: prepareProductImportImages(product.images).images.length, warnings: productWarnings,
        nextImageOffset: 0, hasMore: product.images.length > 0, imageFailures: false,
        requestId, stage, code: "PRODUCT_SAVED", retryable: false,
        message: product.images.length ? "Produto salvo como rascunho. Iniciando as imagens." : "Produto importado como rascunho."
      }, { headers: privateNoStore });
    }

    const preparedImages = prepareProductImportImages(product.images);
    if (imageOffset > preparedImages.images.length) return errorResponse(requestId, "images", {
      code: "INVALID_IMAGE_OFFSET", message: "Posição de imagem inválida.", status: 400, retryable: false
    });
    stage = "source";
    const imported = await auth.supabase.from("product_import_sources").select("product_id")
      .eq("source", source).eq("external_key", externalKey).maybeSingle();
    const productId = text(imported.data?.product_id);
    if (imported.error || !productId) {
      logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: imported.error?.code ?? "SOURCE_NOT_FOUND", productKey });
      return errorResponse(requestId, stage, imported.error
        ? databaseFailure(imported.error.code ?? "SOURCE_LOOKUP_FAILED", imported.error.message)
        : { code: "IMPORT_SOURCE_NOT_FOUND", message: "Salve o produto antes de processar suas imagens.", status: 409, retryable: false });
    }

    stage = "images";
    const variantResult = await auth.supabase.from("product_variants").select("id,color_name").eq("product_id", productId);
    if (variantResult.error) {
      logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: variantResult.error.code ?? "VARIANTS_NOT_AVAILABLE", productKey });
      return errorResponse(requestId, stage, databaseFailure(variantResult.error.code ?? "VARIANTS_NOT_AVAILABLE", variantResult.error.message));
    }
    const variantByColor = new Map<string, string>();
    for (const variant of objectRows(variantResult.data)) {
      const key = normalized(variant.color_name);
      if (!variantByColor.has(key)) variantByColor.set(key, text(variant.id));
    }
    const paths = preparedImages.images.map((image) => {
      return `products/imports/${productId}/${createHash("sha256").update(image.normalizedUrl).digest("hex")}.webp`;
    });
    const imageBatch = preparedImages.images.slice(imageOffset, imageOffset + IMAGE_BATCH_SIZE);
    const batchPaths = paths.slice(imageOffset, imageOffset + IMAGE_BATCH_SIZE);
    const existingResult = batchPaths.length
      ? await auth.supabase.from("product_images").select("storage_path").in("storage_path", batchPaths)
      : { data: [], error: null };
    if (existingResult.error) {
      logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: existingResult.error.code ?? "IMAGES_LOOKUP_FAILED", productKey });
      return errorResponse(requestId, stage, databaseFailure(existingResult.error.code ?? "IMAGES_LOOKUP_FAILED", existingResult.error.message));
    }
    const existingPaths = new Set(objectRows(existingResult.data).map((item) => text(item.storage_path)));
    const processedPaths = new Set<string>();
    const warnings = [...productWarnings, ...preparedImages.warnings];
    let importedImages = 0;
    let imageFailures = false;
    const hasExplicitPrimary = product.images.some((image) => image.primary);
    for (const [batchIndex, image] of imageBatch.entries()) {
      const index = imageOffset + batchIndex;
      const path = paths[index]!;
      if (processedPaths.has(path)) continue;
      processedPaths.add(path);
      if (existingPaths.has(path)) { importedImages += 1; continue; }
      try {
        const downloaded = await downloadShopeeImage(image.url);
        const uploaded = await auth.supabase.storage.from("catalog-public").upload(path, downloaded.bytes, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
        if (uploaded.error) {
          const nowExists = await auth.supabase.from("product_images").select("id").eq("storage_path", path).maybeSingle();
          if (nowExists.data) { importedImages += 1; continue; }
          throw new Error("Falha ao armazenar imagem.");
        }
        const primary = image.primary || (!hasExplicitPrimary && index === 0);
        if (primary) {
          await Promise.all([
            auth.supabase.from("product_images").update({ is_primary: false }).eq("product_id", productId),
            auth.supabase.from("product_media").update({ is_primary: false }).eq("product_id", productId)
          ]);
        }
        const variantId = image.color ? variantByColor.get(normalized(image.color)) ?? null : null;
        const inserted = await auth.supabase.from("product_images").insert({
          product_id: productId, variant_id: variantId, storage_path: path,
          alt_text: image.color ? `${product.name} - ${image.color}` : product.name,
          sort_order: image.order, is_primary: primary, width: downloaded.width, height: downloaded.height
        }).select("id").single();
        if (inserted.error) { await auth.supabase.storage.from("catalog-public").remove([path]); throw new Error("Falha ao associar imagem."); }
        const imageId = text(inserted.data?.id);
        const media = await auth.supabase.from("product_media").insert({
          id: imageId, product_id: productId, variant_id: variantId, media_type: "image",
          storage_path: path, thumbnail_path: null,
          alt_text: image.color ? `${product.name} - ${image.color}` : product.name,
          mime_type: "image/webp", size_bytes: downloaded.bytes.byteLength,
          sort_order: image.order, is_primary: primary, created_by: auth.userId
        });
        if (media.error && !mediaUnavailable(media.error)) {
          await auth.supabase.from("product_images").delete().eq("id", imageId);
          await auth.supabase.storage.from("catalog-public").remove([path]);
          throw new Error("Falha ao associar imagem à galeria.");
        }
        importedImages += 1;
      } catch (error) {
        imageFailures = true;
        warnings.push(`Imagem ${index + 1}: ${error instanceof Error ? error.message : "falhou"}`);
        logServerEvent("warn", "panel_product_import_image_failed", {
          requestId, stage, productKey, imageIndex: index + 1,
          code: error instanceof Error ? error.message.slice(0, 80) : "IMAGE_FAILED"
        });
      }
    }
    const nextImageOffset = Math.min(imageOffset + imageBatch.length, preparedImages.images.length);
    const hasMore = nextImageOffset < preparedImages.images.length;
    return NextResponse.json({
      ok: true, productId, productKey, alreadyImported: true,
      importedImages, expectedImages: preparedImages.images.length, warnings,
      nextImageOffset, hasMore, imageFailures,
      requestId, stage, code: imageFailures ? "IMAGE_PARTIAL_FAILURE" : "IMAGES_PROCESSED", retryable: imageFailures,
      message: hasMore ? "Continuando o envio das imagens."
        : imageFailures ? "Produto salvo como rascunho, mas algumas imagens falharam." : "Produto e imagens importados."
    }, { headers: privateNoStore });
  } catch (error) {
    logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: error instanceof Error ? error.message.slice(0, 80) : "unknown", productKey });
    return errorResponse(requestId, stage, databaseFailure(error instanceof Error ? error.message : "UNKNOWN"));
  }
}
