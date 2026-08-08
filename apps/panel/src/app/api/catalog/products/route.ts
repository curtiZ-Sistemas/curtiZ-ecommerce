import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("restock"),
    productId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(99_999),
    reason: z.string().trim().min(10).max(500)
  }),
  z.object({
    action: z.literal("archive"),
    productId: z.string().uuid()
  }),
  z.object({
    action: z.literal("status"),
    productId: z.string().uuid(),
    status: z.enum(["draft", "active", "archived"])
  }),
  z.object({
    action: z.literal("duplicate"),
    productId: z.string().uuid(),
    name: z.string().trim().min(3).max(160),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180)
  }),
  z.object({
    action: z.literal("save"),
    productId: z.string().uuid().optional(),
    name: z.string().trim().min(3).max(160),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180),
    shortDescription: z.string().trim().min(3).max(280),
    description: z.string().trim().min(3).max(4_000),
    categoryId: z.string().uuid(),
    modelId: z.string().uuid().nullable().optional(),
    collectionId: z.string().uuid().nullable().optional(),
    status: z.enum(["draft", "active", "archived"]),
    featured: z.boolean(),
    priceInCents: z.number().int().min(0).max(100_000_000),
    costInCents: z.number().int().min(0).max(100_000_000),
    weightGrams: z.number().int().min(1).max(100_000),
    heightCm: z.number().positive().max(10_000),
    widthCm: z.number().positive().max(10_000),
    lengthCm: z.number().positive().max(10_000),
    seoTitle: z.string().trim().max(160).optional(),
    seoDescription: z.string().trim().max(320).optional()
  })
]);

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

const serializeProducts = (data: unknown) =>
  rows(data).map((product) => {
    const variants = rows(product.product_variants).map((variant) => {
      const inventory = rows(variant.inventory)[0] ?? record(variant.inventory);
      const available = number(inventory?.available_quantity);
      const reserved = number(inventory?.reserved_quantity);
      return {
        id: text(variant.id),
        sku: text(variant.sku),
        color: text(variant.color_name),
        size: text(variant.size),
        active: variant.active === true,
        available,
        reserved,
        sellable: Math.max(available - reserved, 0)
      };
    });
    return {
      id: text(product.id),
      name: text(product.name),
      slug: text(product.slug),
      status: text(product.status),
      priceInCents: Math.round(number(product.base_price) * 100),
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
  const productSelect =
    "id,name,slug,short_description,description,category_id,model_id,collection_id,status,featured,base_price,cost_price,weight_grams,height_cm,width_cm,length_cm,seo_title,seo_description,product_variants(id,sku,color_name,size,active,inventory(available_quantity,reserved_quantity))";

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

    const filtered = serializeProducts(allProducts).filter((product) => product.stock <= 0);
    const from = (page - 1) * pageSize;
    return {
      data: filtered.slice(from, from + pageSize),
      error: null,
      total: filtered.length,
      serialized: true
    };
  };

  const [result, categories, models, collections] = await Promise.all([
    loadProducts(),
    supabase.from("categories").select("id,name").order("name"),
    supabase.from("product_models").select("id,name").order("name"),
    supabase.from("collections").select("id,name").order("name")
  ]);
  if (result.error || categories.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar os produtos." },
      { status: 503, headers: noStore }
    );
  }

  return NextResponse.json(
    {
      products: "serialized" in result ? result.data : serializeProducts(result.data),
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
        : rows(collections.data).map((item) => ({ id: text(item.id), name: text(item.name) }))
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
    const result = await supabase
      .from("products")
      .update({ status })
      .eq("id", parsed.data.productId)
      .select("id")
      .maybeSingle();
    if (result.error || !result.data) {
      return NextResponse.json(
        { message: "Não foi possível excluir o produto." },
        { status: 409, headers: noStore }
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
      return NextResponse.json(
        { message: "Não foi possível duplicar o produto." },
        { status: 409, headers: noStore }
      );
    }
    return NextResponse.json(
      { ok: true, message: "Produto e variações duplicados como rascunho." },
      { headers: noStore }
    );
  }

  if (parsed.data.action === "save") {
    const values = {
      name: parsed.data.name,
      slug: parsed.data.slug,
      short_description: parsed.data.shortDescription,
      description: parsed.data.description,
      category_id: parsed.data.categoryId,
      model_id: parsed.data.modelId || null,
      collection_id: parsed.data.collectionId || null,
      status: parsed.data.status,
      featured: parsed.data.featured,
      base_price: parsed.data.priceInCents / 100,
      cost_price: parsed.data.costInCents / 100,
      weight_grams: parsed.data.weightGrams,
      height_cm: parsed.data.heightCm,
      width_cm: parsed.data.widthCm,
      length_cm: parsed.data.lengthCm,
      seo_title: parsed.data.seoTitle || null,
      seo_description: parsed.data.seoDescription || null
    };
    const result = parsed.data.productId
      ? await supabase
          .from("products")
          .update({ ...values, updated_by: (await supabase.auth.getUser()).data.user?.id })
          .eq("id", parsed.data.productId)
          .select("id")
          .maybeSingle()
      : await supabase
          .from("products")
          .insert({ ...values, created_by: (await supabase.auth.getUser()).data.user?.id })
          .select("id")
          .single();
    if (result.error || !result.data) {
      return NextResponse.json(
        { message: "Não foi possível salvar o produto." },
        { status: 409, headers: noStore }
      );
    }
    return NextResponse.json(
      {
        ok: true,
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
