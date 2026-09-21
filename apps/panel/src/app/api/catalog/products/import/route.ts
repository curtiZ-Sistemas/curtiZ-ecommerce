import { createHash } from "node:crypto";
import { logServerEvent, readFormResponse } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest, objectRows, privateNoStore, safePanelOrigin, unauthorizedAdminResponse } from "@/lib/admin-api";
import { inspectCatalogImage } from "@/lib/catalog-image";
import { prepareUploadImage } from "@/lib/image-upload";
import { automaticProductSeo } from "@/lib/product-management";
import { PRODUCT_IMPORT_MAX_BYTES, isAllowedShopeeImageUrl, parseProductImportWorkbook } from "@/lib/product-import";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
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

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (!safePanelOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: privateNoStore });
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse(request);
  const permissions = await Promise.all(["products.create", "products.update", "inventory.adjust"].map((permissionCode) =>
    auth.supabase.rpc("has_permission", { permission_code: permissionCode })
  ));
  if (permissions.some((permission) => permission.error || permission.data !== true)) return NextResponse.json({ message: "Seu acesso não permite importar produtos." }, { status: 403, headers: privateNoStore });
  const form = await readFormResponse(request, PRODUCT_IMPORT_MAX_BYTES + 65_536);
  if (form instanceof Response) return form;
  const file = form?.get("file");
  const productKey = text(form?.get("productKey")).trim();
  if (!(file instanceof File) || !file.name.toLocaleLowerCase("pt-BR").endsWith(".xlsx") || file.size < 1 || file.size > PRODUCT_IMPORT_MAX_BYTES || !productKey) {
    return NextResponse.json({ message: "Arquivo ou produto de importação inválido." }, { status: 400, headers: privateNoStore });
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const batch = await parseProductImportWorkbook(bytes);
    const product = batch.products.find((item) => item.key === productKey);
    if (!product) return NextResponse.json({ message: "Produto não encontrado na planilha." }, { status: 404, headers: privateNoStore });
    if (product.issues.some((issue) => issue.level === "error")) {
      return NextResponse.json({ message: product.issues.find((issue) => issue.level === "error")?.message ?? "Produto inválido." }, { status: 409, headers: privateNoStore });
    }

    const [categories, models, collections] = await Promise.all([
      auth.supabase.from("categories").select("id,name"),
      auth.supabase.from("product_models").select("id,name"),
      auth.supabase.from("collections").select("id,name")
    ]);
    if (categories.error || models.error || collections.error) throw new Error("CATALOG_REFERENCE_LOOKUP_FAILED");
    const category = objectRows(categories.data).find((item) => normalized(item.name) === normalized(product.categoryName));
    const model = product.modelName ? objectRows(models.data).find((item) => normalized(item.name) === normalized(product.modelName)) : null;
    const collection = product.collectionName ? objectRows(collections.data).find((item) => normalized(item.name) === normalized(product.collectionName)) : null;
    if (!category) return NextResponse.json({ message: `Categoria não encontrada: ${product.categoryName}.` }, { status: 409, headers: privateNoStore });
    if (product.modelName && !model) return NextResponse.json({ message: `Modelo não encontrado: ${product.modelName}.` }, { status: 409, headers: privateNoStore });
    if (product.collectionName && !collection) return NextResponse.json({ message: `Coleção não encontrada: ${product.collectionName}.` }, { status: 409, headers: privateNoStore });
    const categoryId = text(category.id);
    const seo = automaticProductSeo({ name: product.name, description: product.description, categoryName: product.categoryName });
    const payload = {
      name: product.name, slug: product.slug, shortDescription: product.shortDescription,
      description: product.description, categoryId, categoryIds: [categoryId],
      modelId: model ? text(model.id) : null, collectionId: collection ? text(collection.id) : null,
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
    const batchHash = createHash("sha256").update(bytes).digest("hex");
    const externalKey = product.shopeeId || product.key;
    const saved = await auth.supabase.rpc("admin_import_product_authorized", {
      p_source: product.source.toLocaleLowerCase("pt-BR"), p_external_key: externalKey,
      p_batch_hash: batchHash, p_payload: payload
    });
    const savedData = record(saved.data);
    const productId = text(savedData.productId);
    const alreadyImported = savedData.alreadyImported === true;
    if (saved.error || !productId) {
      logServerEvent("error", "panel_product_import_save_failed", { requestId, code: saved.error?.code ?? "INVALID_RESULT", productKey: product.key });
      return NextResponse.json({ message: "Não foi possível cadastrar este produto.", requestId }, { status: 503, headers: privateNoStore });
    }

    const variantResult = await auth.supabase.from("product_variants").select("id,color_name").eq("product_id", productId);
    if (variantResult.error) throw new Error("VARIANTS_NOT_AVAILABLE");
    const variantByColor = new Map<string, string>();
    for (const variant of objectRows(variantResult.data)) {
      const key = normalized(variant.color_name);
      if (!variantByColor.has(key)) variantByColor.set(key, text(variant.id));
    }
    const paths = product.images.map((image, index) => {
      const identity = `${image.url}\u0000${image.color}\u0000${image.order}\u0000${index}`;
      return `products/${auth.userId}/${productId}/imports/${createHash("sha256").update(identity).digest("hex")}.webp`;
    });
    const existingResult = paths.length
      ? await auth.supabase.from("product_images").select("storage_path").in("storage_path", paths)
      : { data: [], error: null };
    const existingPaths = new Set(objectRows(existingResult.data).map((item) => text(item.storage_path)));
    const warnings = product.issues.filter((issue) => issue.level === "warning").map((issue) => issue.message);
    let importedImages = 0;
    const hasExplicitPrimary = product.images.some((image) => image.primary);
    for (const [index, image] of product.images.entries()) {
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
        warnings.push(`Imagem ${index + 1}: ${error instanceof Error ? error.message : "falhou"}`);
        logServerEvent("warn", "panel_product_import_image_failed", { requestId, productKey: product.key, imageIndex: index + 1 });
      }
    }
    return NextResponse.json({
      ok: true, productId, productKey: product.key, alreadyImported,
      importedImages, expectedImages: product.images.length, warnings,
      message: alreadyImported ? "Produto já importado; imagens pendentes foram reconciliadas." : warnings.length ? "Produto importado com avisos." : "Produto importado."
    }, { headers: privateNoStore });
  } catch (error) {
    logServerEvent("error", "panel_product_import_failed", { requestId, code: error instanceof Error ? error.message.slice(0, 80) : "unknown" });
    return NextResponse.json({ message: "Não foi possível processar este produto.", requestId }, { status: 500, headers: privateNoStore });
  }
}
