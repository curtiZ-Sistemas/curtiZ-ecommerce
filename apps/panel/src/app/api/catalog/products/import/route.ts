import { createHash } from "node:crypto";
import { logServerEvent, postgresUuidSchema, readJsonResponse } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest, objectRows, privateNoStore, safePanelOrigin, unauthorizedAdminResponse } from "@/lib/admin-api";
import { inspectCatalogImage } from "@/lib/catalog-image";
import { prepareUploadImage } from "@/lib/image-upload";
import { automaticProductSeo } from "@/lib/product-management";
import { isAllowedShopeeImageUrl, parseProductImportSessionPayload } from "@/lib/product-import-session";

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

function saveFailure(code: string, requestId: string) {
  const conflict = code === "23505";
  const permissionDenied = code === "42501";
  const schemaUnavailable = ["42883", "PGRST202"].includes(code);
  const invalidData = ["22023", "22P02", "23514"].includes(code);
  const message = conflict
    ? "Já existe um produto, slug ou SKU igual no catálogo."
    : permissionDenied
      ? "Seu acesso não permite concluir esta importação."
      : schemaUnavailable
        ? "A migration do importador ainda não está disponível no banco."
        : invalidData
          ? "Os dados deste produto não atendem às regras do catálogo."
          : "Não foi possível cadastrar este produto.";
  return NextResponse.json({ message, requestId }, {
    status: permissionDenied ? 403 : conflict || invalidData ? 409 : 503,
    headers: privateNoStore
  });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (!safePanelOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: privateNoStore });
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse(request);
  const permissions = await Promise.all(["products.create", "products.update", "inventory.adjust"].map((permissionCode) =>
    auth.supabase.rpc("has_permission", { permission_code: permissionCode })
  ));
  if (permissions.some((permission) => permission.error || permission.data !== true)) {
    return NextResponse.json({ message: "Seu acesso não permite importar produtos." }, { status: 403, headers: privateNoStore });
  }
  const body = await readJsonResponse(request, 8_192);
  if (body instanceof Response) return body;
  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) return NextResponse.json({ message: "Sessão ou produto de importação inválido." }, { status: 400, headers: privateNoStore });

  const { sessionId, productKey, imageOffset } = parsedRequest.data;
  let stage: "source" | "save_product" | "images" = "source";
  try {
    const session = await auth.supabase.from("product_import_sessions").select("payload,batch_hash")
      .eq("id", sessionId).eq("user_id", auth.userId).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (session.error) {
      logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: session.error.code ?? "SESSION_LOOKUP_FAILED", productKey });
      return NextResponse.json({ message: "Não foi possível acessar a sessão de importação.", requestId }, { status: 503, headers: privateNoStore });
    }
    if (!session.data) return NextResponse.json({ message: "A sessão de importação expirou. Selecione a planilha novamente.", requestId }, { status: 410, headers: privateNoStore });

    let sessionPayload;
    try {
      sessionPayload = parseProductImportSessionPayload(session.data.payload);
    } catch {
      logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: "INVALID_SESSION_PAYLOAD", productKey });
      return NextResponse.json({ message: "A sessão de importação é inválida. Selecione a planilha novamente.", requestId }, { status: 409, headers: privateNoStore });
    }
    const product = sessionPayload.batch.products.find((item) => item.key === productKey);
    if (!product) return NextResponse.json({ message: "Produto não encontrado na sessão." }, { status: 404, headers: privateNoStore });
    const productError = product.issues.find((issue) => issue.level === "error");
    if (productError) return NextResponse.json({ message: productError.message }, { status: 409, headers: privateNoStore });
    const reference = sessionPayload.references[product.key];
    const externalKey = product.shopeeId || product.key;
    const source = product.source.toLocaleLowerCase("pt-BR");
    const productWarnings = product.issues.filter((issue) => issue.level === "warning").map((issue) => issue.message);

    if (imageOffset === -1) {
      stage = "save_product";
      if (!reference?.categoryId) return NextResponse.json({ message: "A categoria validada do produto não está disponível." }, { status: 409, headers: privateNoStore });
      const seo = automaticProductSeo({ name: product.name, description: product.description, categoryName: product.categoryName });
      const payload = {
        name: product.name, slug: product.slug, shortDescription: product.shortDescription,
        description: product.description, categoryId: reference.categoryId, categoryIds: [reference.categoryId],
        modelId: reference.modelId, collectionId: reference.collectionId,
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
          stock: 0, active: variant.active, gtin: variant.gtin, mpn: variant.mpn
        })),
        sizeGuide: product.sizeGuide,
        specifications: product.specifications
      };
      const saved = await auth.supabase.rpc("admin_import_product_authorized", {
        p_source: source, p_external_key: externalKey,
        p_batch_hash: text(session.data.batch_hash), p_payload: payload
      });
      const savedData = record(saved.data);
      const productId = text(savedData.productId);
      if (saved.error || !productId) {
        logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: saved.error?.code ?? "INVALID_RESULT", productKey });
        return saveFailure(saved.error?.code ?? "INVALID_RESULT", requestId);
      }
      return NextResponse.json({
        ok: true, productId, productKey, alreadyImported: savedData.alreadyImported === true,
        importedImages: 0, expectedImages: product.images.length, warnings: productWarnings,
        nextImageOffset: 0, hasMore: product.images.length > 0, imageFailures: false,
        message: product.images.length ? "Produto salvo como rascunho. Iniciando as imagens." : "Produto importado como rascunho."
      }, { headers: privateNoStore });
    }

    if (imageOffset > product.images.length) return NextResponse.json({ message: "Posição de imagem inválida." }, { status: 400, headers: privateNoStore });
    stage = "source";
    const imported = await auth.supabase.from("product_import_sources").select("product_id")
      .eq("source", source).eq("external_key", externalKey).maybeSingle();
    const productId = text(imported.data?.product_id);
    if (imported.error || !productId) {
      logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: imported.error?.code ?? "SOURCE_NOT_FOUND", productKey });
      return NextResponse.json({ message: "Salve o produto antes de processar suas imagens.", requestId }, { status: imported.error ? 503 : 409, headers: privateNoStore });
    }

    stage = "images";
    const variantResult = await auth.supabase.from("product_variants").select("id,color_name").eq("product_id", productId);
    if (variantResult.error) throw new Error("VARIANTS_NOT_AVAILABLE");
    const variantByColor = new Map<string, string>();
    for (const variant of objectRows(variantResult.data)) {
      const key = normalized(variant.color_name);
      if (!variantByColor.has(key)) variantByColor.set(key, text(variant.id));
    }
    const paths = product.images.map((image, index) => {
      const identity = `${image.url}\u0000${image.color}\u0000${image.order}\u0000${index}`;
      return `products/imports/${productId}/${createHash("sha256").update(identity).digest("hex")}.webp`;
    });
    const imageBatch = product.images.slice(imageOffset, imageOffset + IMAGE_BATCH_SIZE);
    const batchPaths = paths.slice(imageOffset, imageOffset + IMAGE_BATCH_SIZE);
    const existingResult = batchPaths.length
      ? await auth.supabase.from("product_images").select("storage_path").in("storage_path", batchPaths)
      : { data: [], error: null };
    if (existingResult.error) throw new Error("IMAGES_LOOKUP_FAILED");
    const existingPaths = new Set(objectRows(existingResult.data).map((item) => text(item.storage_path)));
    const warnings = [...productWarnings];
    let importedImages = 0;
    let imageFailures = false;
    const hasExplicitPrimary = product.images.some((image) => image.primary);
    for (const [batchIndex, image] of imageBatch.entries()) {
      const index = imageOffset + batchIndex;
      const path = paths[index]!;
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
        const variantId = image.color && image.applyAllSizes ? variantByColor.get(normalized(image.color)) ?? null : null;
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
        logServerEvent("warn", "panel_product_import_image_failed", { requestId, stage, productKey, imageIndex: index + 1 });
      }
    }
    const nextImageOffset = Math.min(imageOffset + imageBatch.length, product.images.length);
    const hasMore = nextImageOffset < product.images.length;
    return NextResponse.json({
      ok: true, productId, productKey, alreadyImported: true,
      importedImages, expectedImages: product.images.length, warnings,
      nextImageOffset, hasMore, imageFailures,
      message: hasMore ? "Continuando o envio das imagens."
        : imageFailures ? "Produto salvo como rascunho, mas algumas imagens falharam." : "Produto e imagens importados."
    }, { headers: privateNoStore });
  } catch (error) {
    logServerEvent("error", "panel_product_import_failed", { requestId, stage, code: error instanceof Error ? error.message.slice(0, 80) : "unknown", productKey });
    return NextResponse.json({ message: "Não foi possível concluir esta etapa da importação.", requestId }, { status: 500, headers: privateNoStore });
  }
}
