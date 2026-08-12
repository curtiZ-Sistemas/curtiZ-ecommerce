import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicCatalogMediaUrl } from "@/lib/public-media";
import { postgresUuidSchema } from "@/lib/postgres-uuid";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
  sku: z.string().trim().min(2).max(140),
  color: z.string().trim().min(1).max(80),
  colorHex: z.string().regex(/^#[0-9a-f]{6}$/iu).or(z.literal("")),
  size: z.string().trim().min(1).max(40),
  priceInCents: z.number().int().min(0).max(100_000_000).nullable(),
  costInCents: z.number().int().min(0).max(100_000_000).nullable(),
  stock: z.number().int().min(0).max(999_999),
  active: z.boolean()
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
    status: z.enum(["draft", "pending_review", "active", "inactive", "out_of_stock", "archived", "rejected"]),
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
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180),
    shortDescription: z.string().trim().min(3).max(280),
    description: z.string().trim().min(3).max(4_000),
    categoryId: postgresUuidSchema,
    modelId: postgresUuidSchema.nullable().optional(),
    collectionId: postgresUuidSchema.nullable().optional(),
    status: z.enum(["draft", "pending_review", "active", "inactive", "out_of_stock", "archived", "rejected"]),
    statusReason: z.string().trim().max(1000).optional(),
    featured: z.boolean(),
    priceInCents: z.number().int().min(0).max(100_000_000),
    compareAtPriceInCents: z.number().int().min(0).max(100_000_000).nullable(),
    costInCents: z.number().int().min(0).max(100_000_000),
    weightGrams: z.number().int().min(1).max(100_000),
    heightCm: z.number().positive().max(10_000),
    widthCm: z.number().positive().max(10_000),
    lengthCm: z.number().positive().max(10_000),
    seoTitle: z.string().trim().max(160).optional(),
    seoDescription: z.string().trim().max(320).optional(),
    stockReason: z.string().trim().min(10).max(500),
    variants: z.array(variantSchema).max(500)
  })
]);

function logCatalogFailure(operation: string, error: { code?: string; message?: string } | null) {
  console.error("[panel-catalog-api] operation failed", {
    requestId: crypto.randomUUID(),
    operation,
    code: error?.code ?? "unknown",
    message: error?.message?.slice(0, 180) ?? "unknown"
  });
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
        sellable: Math.max(available, 0)
      };
    });
    return {
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
      images: rows(product.product_images)
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
                variantId: text(image.variant_id) || undefined
              }]
            : [];
        })
        .sort((left, right) => Number(right.primary) - Number(left.primary) || left.sortOrder - right.sortOrder),
      stock: variants.reduce((total, variant) => total + variant.sellable, 0),
      variants
    };
  });

const cleanCatalogSearch = (value: string) =>
  value.replaceAll(/[^\p{L}\p{N}\s@.+-]/gu, " ").trim().slice(0, 80);

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
  const status = ["draft", "pending_review", "active", "inactive", "out_of_stock", "archived", "rejected"].includes(requestedStatus)
    ? requestedStatus
    : "";
  const outOfStock = request.nextUrl.searchParams.get("stock") === "out";
  const mediaUrl = (path: string) =>
    publicCatalogMediaUrl(path, {
      storeUrl: process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000",
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL
    });
  const productSelect =
    "id,name,slug,short_description,description,category_id,model_id,collection_id,status,status_reason,featured,base_price,compare_at_price,cost_price,weight_grams,height_cm,width_cm,length_cm,seo_title,seo_description,product_images(id,variant_id,storage_path,alt_text,sort_order,is_primary),product_variants(id,sku,color_name,color_hex,size,price_override,cost_override,active,inventory(available_quantity,reserved_quantity))";

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
    let query = supabase
      .from("products")
      .select(productSelect, withCount ? { count: "exact" } : {});

    if (searchClause) query = query.or(searchClause);
    if (status) query = query.eq("status", status);

    return query.order("updated_at", { ascending: false }).range(from, to);
  };

  const loadProducts = async () => {
    if (productId?.success) {
      const result = await supabase
        .from("products")
        .select(productSelect)
        .eq("id", productId.data)
        .maybeSingle();
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
    archivePermission
  ] = await Promise.all([
    loadProducts(),
    supabase.from("categories").select("id,name").order("name"),
    supabase.from("product_models").select("id,name").order("name"),
    supabase.from("collections").select("id,name").order("name"),
    supabase.rpc("has_permission", { permission_code: "products.create" }),
    supabase.rpc("has_permission", { permission_code: "products.update" }),
    supabase.rpc("has_permission", { permission_code: "inventory.adjust" }),
    supabase.rpc("has_permission", { permission_code: "products.archive" })
  ]);
  const permissionError =
    createPermission.error ?? updatePermission.error ?? stockPermission.error ?? archivePermission.error;
  const capabilities = {
    create:
      !createPermission.error &&
      createPermission.data === true &&
      !updatePermission.error &&
      updatePermission.data === true,
    update: !updatePermission.error && updatePermission.data === true,
    adjustStock: !stockPermission.error && stockPermission.data === true,
    archive: !archivePermission.error && archivePermission.data === true
  };
  const capabilityMessage = permissionError
    ? "N\u00e3o foi poss\u00edvel confirmar as permiss\u00f5es de produto. Verifique se as migrations de permiss\u00e3o foram aplicadas."
    : !capabilities.create
      ? "Cadastro indispon\u00edvel para este acesso: s\u00e3o necess\u00e1rias as permiss\u00f5es products.create e products.update."
      : undefined;
  if (permissionError) logCatalogFailure("load_capabilities", permissionError);

  if (result.error || categories.error) {
    logCatalogFailure(productId?.success ? "load_product" : "load_products", result.error ?? categories.error);
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

  return NextResponse.json(
    {
      products: "serialized" in result ? result.data : serializeProducts(result.data, mediaUrl),
      total: result.total,
      page,
      pageSize,
      categories: rows(categories.data).map((item) => ({
        id: text(item.id),
        name: text(item.name)
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
    if (["inactive", "archived", "rejected"].includes(status) && !reason) {
      return NextResponse.json(
        { message: "Informe o motivo da alteração de status." },
        { status: 400, headers: noStore }
      );
    }
    const result = await supabase.rpc("admin_set_product_status_authorized", {
      p_product_id: parsed.data.productId,
      p_status: status,
      p_reason: reason
    });
    if (result.error || typeof result.data !== "string") {
      logCatalogFailure("set_product_status", result.error);
      return NextResponse.json(
        { message: "Não foi possível alterar o status do produto." },
        { status: result.error?.code === "42501" ? 403 : 409, headers: noStore }
      );
    }
    return NextResponse.json(
      {
        ok: true,
        message:
          status === "archived"
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
    if (["inactive", "archived", "rejected"].includes(parsed.data.status) && !parsed.data.statusReason?.trim()) {
      return NextResponse.json(
        { message: "Informe o motivo da alteração de status." },
        { status: 400, headers: noStore }
      );
    }
    if (parsed.data.status === "active" && !parsed.data.variants.some((variant) => variant.active)) {
      return NextResponse.json(
        { message: "Mantenha pelo menos uma variação ativa antes de publicar." },
        { status: 400, headers: noStore }
      );
    }
    if (
      parsed.data.compareAtPriceInCents !== null &&
      parsed.data.compareAtPriceInCents <= parsed.data.priceInCents
    ) {
      return NextResponse.json(
        { message: "O preço anterior deve ser maior que o preço de venda." },
        { status: 400, headers: noStore }
      );
    }
    const result = await supabase.rpc("admin_save_product_authorized", { p_payload: parsed.data });
    if (result.error || typeof result.data !== "string") {
      logCatalogFailure("save_product", result.error);
      return NextResponse.json(
        { message: "Não foi possível salvar o produto." },
        { status: result.error?.code === "42501" ? 403 : 409, headers: noStore }
      );
    }
    return NextResponse.json(
      {
        ok: true,
        productId: result.data,
        message: parsed.data.productId ? "Produto atualizado." : "Produto criado como configurado."
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
