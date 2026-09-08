import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { evaluateMerchantEligibility, type MerchantCatalogItem } from "@curtiz/domain";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicCatalogMediaUrl } from "@/lib/public-media";
import { postgresUuidSchema } from "@/lib/postgres-uuid";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import {
  automaticProductSeo,
  productDeletionMessage,
  productPublicationMessage
} from "../../../../lib/product-management";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
const rows = (value: unknown): UnknownRecord[] =>
  Array.isArray(value)
    ? value.map(record).filter((item): item is UnknownRecord => Boolean(item))
    : [];
const text = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
const noStore = { "cache-control": "private, no-store" };
const variantSchema = z.object({
  id: postgresUuidSchema.optional(),
  sku: z.string().trim().max(140),
  color: z.string().trim().min(1).max(80),
  colorHex: z.string().regex(/^#[0-9a-f]{6}$/iu).or(z.literal("")),
  size: z.string().trim().min(1).max(40),
  priceInCents: z.number().int().min(0).max(100_000_000).nullable(),
  costInCents: z.number().int().min(0).max(100_000_000).nullable(),
  stock: z.number().int().min(0).max(999_999),
  active: z.boolean(),
  gtin: z.string().trim().max(50),
  mpn: z.string().trim().max(70)
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("restock"),
    productId: postgresUuidSchema,
    variantId: postgresUuidSchema,
    quantity: z.number().int().min(1).max(99_999),
    reason: z.string().trim().min(10).max(500)
  }),
  z.object({
    action: z.literal("archive"),
    productId: postgresUuidSchema,
    reason: z.string().trim().min(3).max(1000)
  }),
  z.object({
    action: z.literal("status"),
    productId: postgresUuidSchema,
    status: z.enum(["draft", "active", "archived"]),
    reason: z.string().trim().min(3).max(1000).optional()
  }),
  z.object({
    action: z.literal("duplicate"),
    productId: postgresUuidSchema,
    name: z.string().trim().min(3).max(160),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180)
  }),
  z.object({
    action: z.literal("save"),
    productId: postgresUuidSchema.optional(),
    name: z.string().trim().min(3).max(160),
    slug: z.string().trim().max(180),
    shortDescription: z.string().trim().max(280).default(""),
    description: z.string().trim().max(4_000).default(""),
    categoryId: postgresUuidSchema.nullable().optional(),
    categoryIds: z.array(postgresUuidSchema).max(50).default([]),
    modelId: postgresUuidSchema.nullable().optional(),
    collectionId: postgresUuidSchema.nullable().optional(),
    status: z.enum(["draft", "active", "archived"]),
    statusReason: z.string().trim().max(1000).optional(),
    featured: z.boolean(),
    priceInCents: z.number().int().min(0).max(100_000_000).nullable(),
    compareAtPriceInCents: z.number().int().min(0).max(100_000_000).nullable(),
    costInCents: z.number().int().min(0).max(100_000_000).nullable(),
    weightGrams: z.number().int().min(1).max(100_000).nullable(),
    heightCm: z.number().positive().max(10_000).nullable(),
    widthCm: z.number().positive().max(10_000).nullable(),
    lengthCm: z.number().positive().max(10_000).nullable(),
    seoTitle: z.string().trim().max(160).optional(),
    seoDescription: z.string().trim().max(320).optional(),
    merchantCondition: z.enum(["new", "refurbished", "used"]).nullable().optional(),
    merchantGender: z.enum(["male", "female", "unisex"]).nullable().optional(),
    merchantAgeGroup: z.enum(["newborn", "infant", "toddler", "kids", "adult"]).nullable().optional(),
    googleProductCategory: z.string().trim().max(500).optional(),
    merchantIdentifierExists: z.boolean().nullable().optional(),
    stockReason: z.string().trim().max(500).default("Cadastro inicial sem estoque informado"),
    variants: z.array(variantSchema).max(500)
  })
]);

const deleteSchema = z.object({ productId: postgresUuidSchema });

type CatalogError = {
  code?: string;
  message?: string;
  details?: string;
} | null;

function logCatalogFailure(operation: string, error: CatalogError) {
  console.error("[panel-catalog-api] operation failed", {
    requestId: crypto.randomUUID(),
    operation,
    code: error?.code ?? "unknown",
    message: error?.message?.slice(0, 180) ?? "unknown",
    details: error?.details?.slice(0, 180)
  });
}

const normalizedErrorMessage = (error: CatalogError) =>
  error?.message?.trim().toLowerCase() ?? "";

function statusMutationError(
  error: CatalogError,
  status: string
): { message: string; statusCode: number } {
  if (error?.code === "42501") {
    return {
      message: "Você não possui permissão para alterar o status deste produto.",
      statusCode: 403
    };
  }

  const message = normalizedErrorMessage(error);

  if (
    status === "active" &&
    message.includes("an active product requires at least one active variant")
  ) {
    return {
      message: "Cadastre e ative pelo menos uma variação antes de publicar o produto.",
      statusCode: 409
    };
  }

  if (status === "active" && message.includes("active product is incomplete")) {
    return {
      message: "Revise nome, categoria e preço antes de publicar o produto.",
      statusCode: 400
    };
  }

  if (message.includes("a status reason is required")) {
    return {
      message: "Informe o motivo da alteração de status.",
      statusCode: 400
    };
  }

  if (message.includes("product not found")) {
    return {
      message: "Produto não encontrado.",
      statusCode: 404
    };
  }

  return {
    message: "Não foi possível alterar o status do produto.",
    statusCode: 409
  };
}

function saveProductError(
  error: CatalogError
): { message: string; statusCode: number } {
  if (error?.code === "42501") {
    return {
      message: "Você não possui permissão para salvar produtos.",
      statusCode: 403
    };
  }

  const message = normalizedErrorMessage(error);

  if (message.includes("an active product requires at least one active variant")) {
    return {
      message: "Mantenha pelo menos uma variação ativa antes de publicar.",
      statusCode: 409
    };
  }

  if (message.includes("active product is incomplete")) {
    return {
      message: "Revise nome, categoria e preço antes de publicar o produto.",
      statusCode: 400
    };
  }

  if (message.includes("invalid product payload")) {
    return {
      message: "Os dados do produto estão incompletos ou inválidos.",
      statusCode: 400
    };
  }

  if (message.includes("invalid product variant")) {
    return {
      message: "Existe uma variação com dados inválidos. Revise SKU, cor, tamanho e estoque.",
      statusCode: 400
    };
  }

  if (message.includes("variant does not belong to product")) {
    return {
      message: "Uma das variações informadas não pertence a este produto.",
      statusCode: 409
    };
  }

  if (message.includes("product not found")) {
    return {
      message: "Produto não encontrado.",
      statusCode: 404
    };
  }

  if (error?.code === "23505") {
    return {
      message: "Já existe um produto ou variação com um valor único informado, como slug ou SKU.",
      statusCode: 409
    };
  }

  if (error?.code === "23503") {
    return {
      message: "Categoria, modelo, coleção ou outro vínculo informado não existe mais.",
      statusCode: 409
    };
  }

  return {
    message: "Não foi possível salvar o produto.",
    statusCode: 409
  };
}

const safeOrigin = (request: NextRequest) => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const configured = new Set([
    new URL(request.url).origin,
    process.env.NEXT_PUBLIC_PANEL_URL,
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim())
  ]);
  return configured.has(origin);
};

async function authorizedClient(request: NextRequest) {
  const demoSession = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demoSession) return null;

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!supabase || !user || userResult?.error) return null;

  const [profileResult, roleResult] = await Promise.all([
    supabase.from("profiles").select("status").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id)
  ]);
  const roles = rows(roleResult.data).map((item) => text(item.role));
  if (
    profileResult.error ||
    roleResult.error ||
    profileResult.data?.status !== "active" ||
    !roles.includes("admin")
  ) {
    return null;
  }
  if (!(await hasRequiredInternalMfa(supabase))) return null;
  return supabase;
}

const serializeProducts = (data: unknown, mediaUrl: (path: string) => string) =>
  rows(data).map((product) => {
    const variants = rows(product.product_variants).map((variant) => {
      const inventory = rows(variant.inventory)[0] ?? record(variant.inventory);
      const available = number(inventory?.available_quantity);
      const reserved = number(inventory?.reserved_quantity);
      return {
        id: text(variant.id),
        sku: text(variant.sku),
        color: text(variant.color_name),
        colorHex: text(variant.color_hex),
        size: text(variant.size),
        active: variant.active === true,
        priceInCents:
          variant.price_override === null || variant.price_override === undefined
            ? null
            : Math.round(number(variant.price_override) * 100),
        costInCents:
          variant.cost_override === null || variant.cost_override === undefined
            ? null
            : Math.round(number(variant.cost_override) * 100),
        available,
        reserved,
        sellable: Math.max(available, 0),
        gtin: text(variant.barcode),
        mpn: text(variant.merchant_mpn)
      };
    });
    const category = rows(product.categories)[0] ?? record(product.categories);
    const categoryLinks = rows(product.product_categories);
    const linkedCategories = categoryLinks.flatMap((link) => {
      const linked = rows(link.categories)[0] ?? record(link.categories);
      const id = text(link.category_id);
      return id ? [{ id, name: text(linked?.name), primary: link.is_primary === true }] : [];
    });
    const categoryIds = linkedCategories.length
      ? linkedCategories.map((item) => item.id)
      : [text(product.category_id)].filter(Boolean);
    const images = rows(product.product_images)
      .flatMap((image) => {
        const url = mediaUrl(text(image.storage_path));
        return url
          ? [{
              id: text(image.id),
              path: text(image.storage_path),
              url,
              alt: text(image.alt_text),
              primary: image.is_primary === true,
              sortOrder: number(image.sort_order),
              width: number(image.width),
              height: number(image.height),
              variantId: text(image.variant_id) || undefined
            }]
          : [];
      })
      .sort((left, right) => Number(right.primary) - Number(left.primary) || left.sortOrder - right.sortOrder);
    const media = rows(product.product_media)
      .flatMap((item) => {
        const path = text(item.storage_path);
        const url = mediaUrl(path);
        const posterPath = text(item.thumbnail_path);
        if (!path || !url) return [];
        return [{
          id: text(item.id),
          path,
          url,
          alt: text(item.alt_text),
          primary: item.is_primary === true,
          sortOrder: number(item.sort_order),
          type: item.media_type === "video" ? "video" as const : "image" as const,
          mimeType: text(item.mime_type),
          variantId: text(item.variant_id) || undefined,
          posterPath: posterPath || undefined,
          posterUrl: posterPath ? mediaUrl(posterPath) : undefined
        }];
      })
      .sort((left, right) => left.sortOrder - right.sortOrder);
    const serialized = {
      id: text(product.id),
      name: text(product.name),
      slug: text(product.slug),
      status: text(product.status),
      statusReason: text(product.status_reason),
      priceInCents: Math.round(number(product.base_price) * 100),
      compareAtPriceInCents:
        product.compare_at_price === null || product.compare_at_price === undefined
          ? null
          : Math.round(number(product.compare_at_price) * 100),
      categoryId: text(product.category_id),
      categoryIds,
      categoryName: text(category?.name),
      categoryNames: linkedCategories.map((item) => item.name).filter(Boolean),
      modelId: text(product.model_id),
      collectionId: text(product.collection_id),
      shortDescription: text(product.short_description),
      description: text(product.description),
      costInCents: Math.round(number(product.cost_price) * 100),
      featured: product.featured === true,
      weightGrams: number(product.weight_grams),
      heightCm: number(product.height_cm),
      widthCm: number(product.width_cm),
      lengthCm: number(product.length_cm),
      seoTitle: text(product.seo_title),
      seoDescription: text(product.seo_description),
      merchantCondition: text(product.merchant_condition) || undefined,
      merchantGender: text(product.merchant_gender) || undefined,
      merchantAgeGroup: text(product.merchant_age_group) || undefined,
      googleProductCategory: text(product.google_product_category),
      merchantIdentifierExists:
        typeof product.merchant_identifier_exists === "boolean"
          ? product.merchant_identifier_exists
          : null,
      images,
      media: media.length
        ? media
        : images.map((image) => ({
            ...image,
            type: "image" as const,
            mimeType: image.path.toLowerCase().endsWith(".webp")
              ? "image/webp"
              : image.path.toLowerCase().match(/\.jpe?g$/u)
                ? "image/jpeg"
                : "image/png"
          })),
      stock: variants.reduce((total, variant) => total + variant.sellable, 0),
      variants
    };
    const reasons = new Set<string>();
    const warnings = new Set<string>();
    let eligibleVariants = 0;
    const activeVariants = variants.filter((variant) => variant.active);
    for (const variant of activeVariants) {
      const effectivePrice = variant.priceInCents ?? serialized.priceInCents;
      const originalPrice = serialized.compareAtPriceInCents ?? 0;
      const candidate: MerchantCatalogItem = {
        id: variant.id,
        title: [serialized.name, variant.color, variant.size].join(" - "),
        description: serialized.description,
        link: `https://curtiz.com.br/produto/${encodeURIComponent(serialized.slug)}?variant=${encodeURIComponent(variant.id)}`,
        canonicalLink: `https://curtiz.com.br/produto/${encodeURIComponent(serialized.slug)}`,
        images: images
          .filter((image) => !image.variantId || image.variantId === variant.id)
          .map((image) => ({ url: image.url, width: image.width, height: image.height })),
        availability: variant.sellable > 0 ? "in_stock" : "out_of_stock",
        priceInCents: originalPrice > effectivePrice ? originalPrice : effectivePrice,
        ...(originalPrice > effectivePrice ? { salePriceInCents: effectivePrice } : {}),
        condition: serialized.merchantCondition as MerchantCatalogItem["condition"],
        brand: "curti Z",
        gtin: variant.gtin || undefined,
        mpn: variant.mpn || undefined,
        identifierExists: serialized.merchantIdentifierExists ?? undefined,
        googleProductCategory: serialized.googleProductCategory || undefined,
        productType: serialized.categoryName,
        color: variant.color,
        size: variant.size,
        gender: serialized.merchantGender as MerchantCatalogItem["gender"],
        ageGroup: serialized.merchantAgeGroup as MerchantCatalogItem["ageGroup"],
        itemGroupId: serialized.id,
        itemGroupTitle: serialized.name
      };
      const result = evaluateMerchantEligibility(candidate);
      if (result.eligible) eligibleVariants += 1;
      result.reasons.forEach((reason) => reasons.add(reason));
      result.warnings.forEach((warning) => warnings.add(warning));
    }
    if (serialized.status !== "active") reasons.add("Produto não está publicado.");
    if (!activeVariants.length) reasons.add("Produto sem variações ativas.");
    return {
      ...serialized,
      merchantEligibility: {
        eligible:
          serialized.status === "active" &&
          activeVariants.length > 0 &&
          eligibleVariants === activeVariants.length,
        eligibleVariants,
        activeVariants: activeVariants.length,
        reasons: [...reasons],
        warnings: [...warnings]
      }
    };
  });

const cleanCatalogSearch = (value: string) =>
  value.replaceAll(/[^\p{L}\p{N}\s@.+-]/gu, " ").trim().slice(0, 80);

const catalogCode = (value: string, upper = false) => {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 120);
  return upper ? normalized.toUpperCase() : normalized;
};

async function uniqueCatalogCode(
  supabase: Awaited<ReturnType<typeof authorizedClient>> & {},
  table: "products" | "product_variants",
  column: "slug" | "sku",
  requested: string,
  fallback: string,
  currentId?: string
) {
  const base = catalogCode(requested || fallback, column === "sku") ||
    (column === "sku" ? "PRODUTO" : "produto");
  for (let suffix = 1; suffix <= 999; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    let query = supabase.from(table).select("id").eq(column, candidate).limit(1);
    if (currentId) query = query.neq("id", currentId);
    const result = await query.maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return candidate;
  }
  throw new Error(`could not generate unique ${column}`);
}

export async function GET(request: NextRequest) {
  const supabase = await authorizedClient(request);
  if (!supabase) {
    return NextResponse.json(
      { message: "Acesso não autorizado ou catálogo indisponível." },
      { status: 401, headers: noStore }
    );
  }

  const readPermission = await supabase.rpc("has_permission", {
    permission_code: "products.read"
  });
  if (readPermission.error) {
    logCatalogFailure("authorize_read", readPermission.error);
    return NextResponse.json(
      { message: "Não foi possível confirmar a permissão de leitura do catálogo." },
      { status: 503, headers: noStore }
    );
  }
  if (readPermission.data !== true) {
    return NextResponse.json(
      { message: "Você não possui permissão para consultar produtos." },
      { status: 403, headers: noStore }
    );
  }

  const productIdParam = request.nextUrl.searchParams.get("productId");
  const productId = productIdParam
    ? postgresUuidSchema.safeParse(productIdParam)
    : null;
  if (productId && !productId.success) {
    return NextResponse.json(
      { message: "Identificador de produto inválido." },
      { status: 400, headers: noStore }
    );
  }

  const page = Math.max(
    1,
    Math.min(10_000, Number(request.nextUrl.searchParams.get("page")) || 1)
  );
  const pageSize = 20;
  const queryText = cleanCatalogSearch(request.nextUrl.searchParams.get("q") ?? "");
  const requestedStatus = request.nextUrl.searchParams.get("status") ?? "";
  const status = ["draft", "active", "archived"].includes(requestedStatus)
    ? requestedStatus
    : "";
  const outOfStock = request.nextUrl.searchParams.get("stock") === "out";
  const mediaUrl = (path: string) =>
    publicCatalogMediaUrl(path, {
      storeUrl: process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000",
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL
    });
  const legacyProductSelect =
    "id,name,slug,short_description,description,category_id,model_id,collection_id,status,status_reason,featured,base_price,compare_at_price,cost_price,weight_grams,height_cm,width_cm,length_cm,seo_title,seo_description,merchant_condition,merchant_gender,merchant_age_group,google_product_category,merchant_identifier_exists,categories!products_category_id_fkey(name),product_images(id,variant_id,storage_path,alt_text,sort_order,is_primary,width,height),product_media(id,variant_id,media_type,storage_path,thumbnail_path,alt_text,mime_type,sort_order,is_primary),product_variants(id,sku,color_name,color_hex,size,price_override,cost_override,active,barcode,merchant_mpn,inventory(available_quantity,reserved_quantity))";
  const compatibleProductSelect =
    "id,name,slug,short_description,description,category_id,model_id,collection_id,status,status_reason,featured,base_price,compare_at_price,cost_price,weight_grams,height_cm,width_cm,length_cm,seo_title,seo_description,categories!products_category_id_fkey(name),product_images(id,variant_id,storage_path,alt_text,sort_order,is_primary,width,height),product_variants(id,sku,color_name,color_hex,size,price_override,cost_override,active,barcode,merchant_mpn,inventory(available_quantity,reserved_quantity))";
  const productSelect =
    `${legacyProductSelect},product_categories(category_id,is_primary,categories(id,name))`;

  const loadWithCompatibility = async <T extends { error: CatalogError }>(
    run: (select: string) => PromiseLike<T>
  ): Promise<T> => {
    const selections = [
      ["productSelect", productSelect],
      ["legacyProductSelect", legacyProductSelect],
      ["compatibleProductSelect", compatibleProductSelect]
    ] as const;
    for (const [index, [name, select]] of selections.entries()) {
      const result = await run(select);
      if (!result.error) {
        if (index > 0) console.warn("[panel-catalog-api] compatibility select used", { select: name });
        return result;
      }
      logCatalogFailure(`select:${name}`, result.error);
      // Compatibility is only for older schemas, never permission or transport failures.
      if (!["42703", "42P01", "PGRST200", "PGRST204", "PGRST205"].includes(result.error.code ?? "") || index === selections.length - 1) {
        return result;
      }
    }
    throw new Error("No catalog selection available");
  };

  const variantMatches = queryText
    ? await (async () => {
        const data: UnknownRecord[] = [];
        const chunkSize = 1_000;
        let offset = 0;

        while (true) {
          const result = await supabase
            .from("product_variants")
            .select("product_id")
            .ilike("sku", `%${queryText}%`)
            .order("product_id")
            .range(offset, offset + chunkSize - 1);

          if (result.error) return { data: [], error: result.error };
          const batch = rows(result.data);
          data.push(...batch);
          if (batch.length < chunkSize) return { data, error: null };
          offset += chunkSize;
        }
      })()
    : null;

  if (variantMatches?.error) {
    logCatalogFailure("search_variants", variantMatches.error);
    return NextResponse.json(
      { message: "Não foi possível filtrar os produtos." },
      { status: 503, headers: noStore }
    );
  }

  const matchingProductIds = [
    ...new Set(rows(variantMatches?.data).map((item) => text(item.product_id)).filter(Boolean))
  ];
  const searchClause = queryText
    ? [
        `name.ilike.%${queryText}%`,
        `slug.ilike.%${queryText}%`,
        matchingProductIds.length ? `id.in.(${matchingProductIds.join(",")})` : ""
      ]
        .filter(Boolean)
        .join(",")
    : "";

  const loadProductRange = async (from: number, to: number, withCount: boolean) => {
    const run = (select: string) => {
      let query = supabase
        .from("products")
        .select(select, withCount ? { count: "exact" } : {});

      if (searchClause) query = query.or(searchClause);
      if (status) query = query.eq("status", status);

      return query.order("updated_at", { ascending: false }).range(from, to);
    };
    return loadWithCompatibility(run);
  };

  const loadProducts = async () => {
    if (productId?.success) {
      const loadProduct = (select: string) =>
        supabase
          .from("products")
          .select(select)
          .eq("id", productId.data)
          .maybeSingle();
      const result = await loadWithCompatibility(loadProduct);
      return {
        data: result.data ? [result.data] : [],
        error: result.error,
        total: result.data ? 1 : 0,
        productNotFound: !result.error && !result.data
      };
    }

    if (!outOfStock) {
      const from = (page - 1) * pageSize;
      const result = await loadProductRange(from, from + pageSize - 1, true);
      return {
        data: result.data,
        error: result.error,
        total: result.count ?? 0
      };
    }

    const allProducts: UnknownRecord[] = [];
    const chunkSize = 500;
    let offset = 0;

    while (true) {
      const result = await loadProductRange(offset, offset + chunkSize - 1, false);
      if (result.error) return { data: [], error: result.error, total: 0 };
      const batch = rows(result.data);
      allProducts.push(...batch);
      if (batch.length < chunkSize) break;
      offset += chunkSize;
    }

    const filtered = serializeProducts(allProducts, mediaUrl).filter((product) => product.stock <= 0);
    const from = (page - 1) * pageSize;
    return {
      data: filtered.slice(from, from + pageSize),
      error: null,
      total: filtered.length,
      serialized: true
    };
  };

  const [
    result,
    categories,
    models,
    collections,
    createPermission,
    updatePermission,
    stockPermission,
    archivePermission,
    deletePermission
  ] = await Promise.all([
    loadProducts(),
    supabase.from("categories").select("id,name,parent_id").order("name").limit(500),
    supabase.from("product_models").select("id,name").order("name").limit(500),
    supabase.from("collections").select("id,name").order("name").limit(500),
    supabase.rpc("has_permission", { permission_code: "products.create" }),
    supabase.rpc("has_permission", { permission_code: "products.update" }),
    supabase.rpc("has_permission", { permission_code: "inventory.adjust" }),
    supabase.rpc("has_permission", { permission_code: "products.archive" }),
    supabase.rpc("has_permission", { permission_code: "products.delete" })
  ]);
  const permissionError =
    createPermission.error ?? updatePermission.error ?? stockPermission.error ?? archivePermission.error ?? deletePermission.error;
  const capabilities = {
    create:
      !createPermission.error &&
      createPermission.data === true &&
      !updatePermission.error &&
      updatePermission.data === true,
    update: !updatePermission.error && updatePermission.data === true,
    adjustStock: !stockPermission.error && stockPermission.data === true,
    archive: !archivePermission.error && archivePermission.data === true,
    delete: !deletePermission.error && deletePermission.data === true
  };
  const capabilityMessage = permissionError
    ? "N\u00e3o foi poss\u00edvel confirmar as permiss\u00f5es de produto. Verifique se as migrations de permiss\u00e3o foram aplicadas."
    : !capabilities.create
      ? "Cadastro indispon\u00edvel para este acesso: s\u00e3o necess\u00e1rias as permiss\u00f5es products.create e products.update."
      : undefined;
  if (permissionError) logCatalogFailure("load_capabilities", permissionError);

  if (result.error) {
    logCatalogFailure(productId?.success ? "load_product" : "load_products", result.error);
    return NextResponse.json(
      {
        message: productId?.success
          ? "Não foi possível carregar o produto."
          : "Não foi possível carregar os produtos.",
        capabilities,
        capabilityMessage
      },
      { status: 503, headers: noStore }
    );
  }
  if ("productNotFound" in result && result.productNotFound) {
    return NextResponse.json(
      {
        message: "Produto não encontrado.",
        capabilities,
        capabilityMessage
      },
      { status: 404, headers: noStore }
    );
  }

  const serializedProducts: ReturnType<typeof serializeProducts> = "serialized" in result
    ? (Array.isArray(result.data) ? result.data as ReturnType<typeof serializeProducts> : [])
    : serializeProducts(result.data, mediaUrl);
  let deleteEligibility: UnknownRecord = {};
  if (capabilities.delete && serializedProducts.length) {
    const eligibilityResult = await supabase.rpc("admin_product_delete_eligibility", {
      p_product_ids: serializedProducts.map((product) => product.id)
    });
    if (eligibilityResult.error) {
      logCatalogFailure("load_delete_eligibility", eligibilityResult.error);
    } else {
      deleteEligibility = record(eligibilityResult.data) ?? {};
    }
  }

  const categoryRows = rows(categories.data);
  const categoriesById = new Map(categoryRows.map((item) => [text(item.id), item]));
  const categoryName = (item: UnknownRecord) => {
    const names = [text(item.name)];
    let parentId = text(item.parent_id);
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId) && names.length < 6) {
      visited.add(parentId);
      const parent = categoriesById.get(parentId);
      if (!parent) break;
      names.unshift(text(parent.name));
      parentId = text(parent.parent_id);
    }
    return names.filter(Boolean).join(" > ");
  };

  return NextResponse.json(
    {
      products: serializedProducts.map((product) => ({
        ...product,
        canDelete:
          deleteEligibility[product.id] === true ||
          record(deleteEligibility[product.id])?.canDelete === true,
        deleteBlockers: Array.isArray(record(deleteEligibility[product.id])?.blockers)
          ? (record(deleteEligibility[product.id])?.blockers as unknown[]).filter(
              (item): item is string => typeof item === "string" && item.length > 0
            )
          : []
      })),
      total: result.total,
      page,
      pageSize,
      categories: categoryRows.map((item) => ({
        id: text(item.id),
        name: categoryName(item)
      })),
      models: models.error
        ? []
        : rows(models.data).map((item) => ({ id: text(item.id), name: text(item.name) })),
      collections: collections.error
        ? []
        : rows(collections.data).map((item) => ({ id: text(item.id), name: text(item.name) })),
      capabilities,
      capabilityMessage
    },
    { headers: noStore }
  );
}

export async function PATCH(request: NextRequest) {
  if (!safeOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: noStore }
    );
  }
  const supabase = await authorizedClient(request);
  if (!supabase) {
    return NextResponse.json(
      { message: "Acesso não autorizado." },
      { status: 401, headers: noStore }
    );
  }

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Revise os dados informados." },
      { status: 400, headers: noStore }
    );
  }

  if (parsed.data.action === "archive" || parsed.data.action === "status") {
    const status = parsed.data.action === "archive" ? "archived" : parsed.data.status;
    const reason = parsed.data.reason?.trim() || null;
    if (status === "archived" && !reason) {
      return NextResponse.json(
        { message: "Informe o motivo da alteração de status." },
        { status: 400, headers: noStore }
      );
    }
    if (status === "active") {
      const product = await supabase
        .from("products")
        .select("id,name,category_id,base_price,product_variants(active)")
        .eq("id", parsed.data.productId)
        .maybeSingle();
      if (product.error) {
        return NextResponse.json(
          { message: "Não foi possível validar o produto para publicação." },
          { status: 503, headers: noStore }
        );
      }
      if (!product.data) {
        return NextResponse.json({ message: "Produto não encontrado." }, { status: 404, headers: noStore });
      }
      const publicationMessage = productPublicationMessage({
        name: text(product.data.name),
        categoryIds: text(product.data.category_id) ? [text(product.data.category_id)] : [],
        priceInCents: Math.round(number(product.data.base_price) * 100),
        variants: rows(product.data.product_variants).map((variant) => ({ active: variant.active === true }))
      });
      if (publicationMessage) {
        return NextResponse.json({ message: publicationMessage }, { status: 400, headers: noStore });
      }
    }
    const result = await supabase.rpc("admin_set_product_status_authorized", {
      p_product_id: parsed.data.productId,
      p_status: status,
      p_reason: reason
    });
    if (result.error || typeof result.data !== "string") {
      logCatalogFailure("set_product_status", result.error);
      const mappedError = statusMutationError(result.error, status);

      return NextResponse.json(
        { message: mappedError.message },
        { status: mappedError.statusCode, headers: noStore }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        message:
          status === "active"
            ? "Produto publicado com sucesso."
            : status === "archived"
              ? "Produto arquivado sem apagar o histórico de pedidos."
              : "Status do produto atualizado."
      },
      { headers: noStore }
    );
  }

  if (parsed.data.action === "duplicate") {
    const result = await supabase.rpc("duplicate_product", {
      p_product_id: parsed.data.productId,
      p_name: parsed.data.name,
      p_slug: parsed.data.slug
    });
    if (result.error) {
      logCatalogFailure("duplicate_product", result.error);
      return NextResponse.json(
        { message: "Não foi possível duplicar o produto." },
        { status: result.error?.code === "42501" ? 403 : 409, headers: noStore }
      );
    }
    return NextResponse.json(
      { ok: true, message: "Produto e variações duplicados como rascunho." },
      { headers: noStore }
    );
  }

  if (parsed.data.action === "save") {
    const categoryIds = [
      ...new Set([
        ...(parsed.data.categoryId ? [parsed.data.categoryId] : []),
        ...parsed.data.categoryIds
      ])
    ];
    const slug = await uniqueCatalogCode(
      supabase,
      "products",
      "slug",
      parsed.data.slug,
      parsed.data.name,
      parsed.data.productId
    );
    const variants: z.infer<typeof variantSchema>[] = [];
    const usedSkus = new Set<string>();
    for (const variant of parsed.data.variants) {
      let sku = await uniqueCatalogCode(
        supabase,
        "product_variants",
        "sku",
        variant.sku,
        `${parsed.data.name}-${variant.color}-${variant.size}`,
        variant.id
      );
      let localSuffix = 2;
      while (usedSkus.has(sku.toLocaleUpperCase("pt-BR"))) {
        sku = await uniqueCatalogCode(
          supabase,
          "product_variants",
          "sku",
          `${sku}-${localSuffix}`,
          `${parsed.data.name}-${variant.color}-${variant.size}-${localSuffix}`,
          variant.id
        );
        localSuffix += 1;
      }
      usedSkus.add(sku.toLocaleUpperCase("pt-BR"));
      variants.push({
        ...variant,
        sku
      });
    }
    const payload = {
      ...parsed.data,
      slug,
      categoryId: parsed.data.categoryId ?? categoryIds[0] ?? null,
      categoryIds,
      variants
    };
    if (payload.status === "archived" && !payload.statusReason?.trim()) {
      return NextResponse.json(
        { message: "Informe o motivo da alteração de status." },
        { status: 400, headers: noStore }
      );
    }
    const publicationMessage = payload.status === "active"
      ? productPublicationMessage({
          name: payload.name,
          categoryIds,
          priceInCents: payload.priceInCents,
          variants: payload.variants
        })
      : null;
    if (publicationMessage) {
      return NextResponse.json(
        { message: publicationMessage },
        { status: 400, headers: noStore }
      );
    }
    if (
      payload.compareAtPriceInCents !== null &&
      payload.priceInCents !== null &&
      payload.compareAtPriceInCents <= payload.priceInCents
    ) {
      return NextResponse.json(
        { message: "O preço anterior deve ser maior que o preço de venda." },
        { status: 400, headers: noStore }
      );
    }
    const categoryResult = payload.categoryId
      ? await supabase.from("categories").select("name").eq("id", payload.categoryId).maybeSingle()
      : null;
    if (categoryResult?.error) {
      return NextResponse.json(
        { message: "A categoria selecionada não está disponível." },
        { status: 409, headers: noStore }
      );
    }
    const seo = automaticProductSeo({
      name: payload.name,
      description: payload.description,
      categoryName: text(categoryResult?.data?.name)
    });
    const result = await supabase.rpc("admin_save_product_authorized", {
      p_payload: {
        ...payload,
        seoTitle: seo.title,
        seoDescription: seo.description
      }
    });

    if (result.error || typeof result.data !== "string") {
      logCatalogFailure("save_product", result.error);
      const mappedError = saveProductError(result.error);

      return NextResponse.json(
        { message: mappedError.message },
        { status: mappedError.statusCode, headers: noStore }
      );
    }
    return NextResponse.json(
      {
        ok: true,
        productId: result.data,
        message: payload.productId ? "Produto atualizado." : "Produto criado como configurado."
      },
      { headers: noStore }
    );
  }

  const restockResult = await supabase.rpc("admin_restock_inventory", {
    p_product_id: parsed.data.productId,
    p_variant_id: parsed.data.variantId,
    p_quantity: parsed.data.quantity,
    p_reason: parsed.data.reason
  });
  if (restockResult.error) {
    return NextResponse.json(
      { message: "Não foi possível registrar a reposição de estoque." },
      { status: restockResult.error.code === "42501" ? 403 : 409, headers: noStore }
    );
  }

  return NextResponse.json(
    { ok: true, message: "Estoque atualizado com justificativa e auditoria." },
    { headers: noStore }
  );
}

export async function DELETE(request: NextRequest) {
  if (!safeOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: noStore }
    );
  }
  const supabase = await authorizedClient(request);
  if (!supabase) {
    return NextResponse.json(
      { message: "Acesso não autorizado." },
      { status: 401, headers: noStore }
    );
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Identificador de produto inválido." },
      { status: 400, headers: noStore }
    );
  }

  const result = await supabase.rpc("admin_delete_product", {
    p_product_id: parsed.data.productId
  });
  if (result.error) {
    logCatalogFailure("delete_product", result.error);
    const related = result.error.code === "23503" || normalizedErrorMessage(result.error).includes("related records");
    const forbidden = result.error.code === "42501";
    const notFound = result.error.code === "P0002";
    let blockers: string[] = [];
    if (related) {
      const eligibility = await supabase.rpc("admin_product_delete_eligibility", {
        p_product_ids: [parsed.data.productId]
      });
      if (eligibility.error) logCatalogFailure("delete_product_blockers", eligibility.error);
      const reasons = record(record(eligibility.data)?.[parsed.data.productId])?.blockers;
      if (Array.isArray(reasons)) blockers = reasons.filter((reason): reason is string => typeof reason === "string");
    }
    return NextResponse.json(
      {
        message: forbidden
          ? "Você não possui permissão para excluir produtos."
          : related
            ? blockers.length ? productDeletionMessage(blockers) : "Este produto possui registros relacionados e não pode ser excluído. Use Arquivar para preservar o histórico."
            : notFound
              ? "Produto não encontrado."
              : "Não foi possível excluir o produto."
      },
      { status: forbidden ? 403 : notFound ? 404 : related ? 409 : 503, headers: noStore }
    );
  }

  const payload = record(result.data);
  const storagePaths = Array.isArray(payload?.storagePaths)
    ? payload.storagePaths.filter((path): path is string => typeof path === "string" && path.length > 0)
    : [];
  if (storagePaths.length) {
    const removed = await supabase.storage.from("catalog-public").remove(storagePaths);
    if (removed.error) logCatalogFailure("delete_product_storage", removed.error);
  }

  return NextResponse.json(
    { ok: true, message: "Produto excluído permanentemente." },
    { headers: noStore }
  );
}
