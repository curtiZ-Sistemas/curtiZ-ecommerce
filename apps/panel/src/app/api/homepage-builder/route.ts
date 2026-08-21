import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  objectRows,
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "@/lib/admin-api";
import {
  authorizeHomepageRequest,
  homepagePermissions,
  type HomepagePermission
} from "@/lib/homepage-api";

export const dynamic = "force-dynamic";

const sectionTypes = [
  "banner_hero", "product_carousel", "product_grid", "product_horizontal", "categories_grid",
  "models_grid", "brands_strip", "collections_grid", "image_links", "image_mosaic",
  "promotions", "flash_offers", "best_sellers", "launches", "featured_products",
  "recommended_products", "manual_products", "campaigns", "benefits", "reviews_carousel",
  "editorial", "video", "image_text", "countdown", "newsletter", "institutional",
  "quick_links", "safe_component"
] as const;

const layouts = [
  "one_column", "two_equal", "two_featured", "three_equal", "three_centered", "four_columns",
  "editorial_mosaic", "carousel", "grid", "horizontal_strip", "full_width", "content_centered"
] as const;

const itemMediaSchema = z.object({
  path: z.string().trim().max(500),
  role: z.enum(["desktop", "tablet", "mobile", "video", "background", "thumbnail"]),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]),
  sizeBytes: z.number().int().min(1).max(52_428_800)
});

const itemSchema = z.object({
  itemType: z.string().trim().min(1).max(50).default("content"),
  internalName: z.string().trim().min(1).max(120),
  title: z.string().trim().max(160).optional(),
  subtitle: z.string().trim().max(240).optional(),
  description: z.string().trim().max(2_000).optional(),
  altText: z.string().trim().max(300).optional(),
  decorative: z.boolean().default(false),
  targetType: z.enum(["none", "product", "category", "subcategory", "model", "brand", "collection", "campaign", "page", "guide", "search", "offer", "external_url"]).default("none"),
  targetId: z.string().uuid().optional(),
  targetRoute: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().min(0).max(100),
  config: z.record(z.string(), z.unknown()).default({}),
  media: z.array(itemMediaSchema).max(6).default([])
});

const sectionPayloadSchema = z.object({
  id: z.string().uuid().optional(),
  internalName: z.string().trim().min(3).max(120),
  sectionType: z.enum(sectionTypes),
  title: z.string().trim().max(160).optional(),
  subtitle: z.string().trim().max(240).optional(),
  description: z.string().trim().max(2_000).optional(),
  layout: z.enum(layouts),
  visibility: z.enum(["all", "desktop", "tablet", "mobile"]),
  style: z.record(z.string(), z.unknown()).default({}),
  content: z.record(z.string(), z.unknown()).default({}),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  sortOrder: z.number().int().min(0).max(100),
  changeSummary: z.string().trim().min(3).max(500),
  items: z.array(itemSchema).max(24)
}).superRefine((value, context) => {
  if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Período inválido." });
  }
  value.items.forEach((item, index) => {
    if (item.media.length && !item.decorative && !item.altText) {
      context.addIssue({ code: "custom", path: ["items", index, "altText"], message: "Texto alternativo obrigatório." });
    }
    if (item.targetType !== "none" && !item.targetRoute) {
      context.addIssue({ code: "custom", path: ["items", index, "targetRoute"], message: "Destino obrigatório." });
    }
    if (value.sectionType === "reviews_carousel") {
      const origin = typeof item.config.origin === "string" ? item.config.origin : "manual";
      if (!(["manual", "customer_review"] as string[]).includes(origin)) {
        context.addIssue({ code: "custom", path: ["items", index, "config", "origin"], message: "Origem inválida." });
      }
      if (origin === "manual" && item.config.rating !== undefined && (typeof item.config.rating !== "number" || item.config.rating < 1 || item.config.rating > 5)) {
        context.addIssue({ code: "custom", path: ["items", index, "config", "rating"], message: "Nota entre 1 e 5 obrigatória." });
      }
      if (origin === "customer_review" && !z.string().uuid().safeParse(item.config.reviewId).success) {
        context.addIssue({ code: "custom", path: ["items", index, "config", "reviewId"], message: "Avaliação real obrigatória." });
      }
    }
  });
  if (value.sectionType === "benefits" && value.items.length > 4) {
    context.addIssue({ code: "custom", path: ["items"], message: "A faixa aceita no máximo quatro benefícios." });
  }
  if (value.sectionType === "reviews_carousel") {
    const limit = Number(value.content.limit ?? 6);
    const cards = Number(value.content.desktopCards ?? 3);
    const interval = Number(value.content.autoplayInterval ?? 6000);
    if (!Number.isInteger(limit) || limit < 1 || limit > 12) context.addIssue({ code: "custom", path: ["content", "limit"], message: "Quantidade de depoimentos inválida." });
    if (![2, 3, 4].includes(cards)) context.addIssue({ code: "custom", path: ["content", "desktopCards"], message: "Quantidade por viewport inválida." });
    if (interval < 3000 || interval > 15000) context.addIssue({ code: "custom", path: ["content", "autoplayInterval"], message: "Intervalo de autoplay inválido." });
  }
  if (value.sectionType === "best_sellers") {
    const salesPeriod = value.content.salesPeriod ?? "90d";
    const rankingMetric = value.content.rankingMetric ?? "units";
    if (typeof salesPeriod !== "string" || !["30d", "90d", "all"].includes(salesPeriod)) context.addIssue({ code: "custom", path: ["content", "salesPeriod"], message: "Período inválido." });
    if (typeof rankingMetric !== "string" || !["units", "revenue"].includes(rankingMetric)) context.addIssue({ code: "custom", path: ["content", "rankingMetric"], message: "Critério inválido." });
  }
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), expectedRevision: z.number().int().positive().optional(), payload: sectionPayloadSchema }),
  z.object({ action: z.literal("transition"), sectionId: z.string().uuid(), transition: z.enum(["submit_review", "approve", "reject", "hide", "archive", "restore", "lock", "unlock"]), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("reorder"), sectionIds: z.array(z.string().uuid()).min(1).max(40), revisions: z.array(z.number().int().positive()).min(1).max(40) }),
  z.object({ action: z.literal("publish"), reason: z.string().trim().min(3).max(1000), scheduledAt: z.string().datetime({ offset: true }).optional() }),
  z.object({ action: z.literal("cancel_publication"), pageVersionId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("duplicate"), sectionId: z.string().uuid() }),
  z.object({ action: z.literal("restore_version"), versionId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
]);

const text = (record: Record<string, unknown>, key: string) =>
  typeof record[key] === "string" ? record[key] : "";
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const safeSearch = (value: string) =>
  value.replaceAll(/[^\p{L}\p{N}\s._-]/gu, " ").trim().slice(0, 80);

async function capabilities(request: NextRequest) {
  const entries = await Promise.all(homepagePermissions.map(async (permission) => [
    permission,
    Boolean(await authorizeHomepageRequest(request, permission))
  ] as const));
  return Object.fromEntries(entries) as Record<HomepagePermission, boolean>;
}

async function targets(request: NextRequest) {
  const auth = await authorizeHomepageRequest(request, "homepage.view");
  if (!auth) return unauthorizedAdminResponse();
  const type = request.nextUrl.searchParams.get("type") ?? "";
  const query = safeSearch(request.nextUrl.searchParams.get("q") ?? "");
  let result;
  if (type === "product") {
    let builder = auth.supabase.from("products").select("id,name,slug,status,base_price,product_images(storage_path,alt_text,is_primary),product_variants(sku,inventory(available_quantity,reserved_quantity))").eq("status", "active").order("name").limit(30);
    if (query) builder = builder.or(`name.ilike.%${query}%,slug.ilike.%${query}%`);
    result = await builder;
  } else if (type === "category" || type === "subcategory") {
    let builder = auth.supabase.from("categories").select("id,name,slug,active,parent_id").eq("active", true).order("name").limit(40);
    builder = type === "subcategory" ? builder.not("parent_id", "is", null) : builder.is("parent_id", null);
    if (query) builder = builder.or(`name.ilike.%${query}%,slug.ilike.%${query}%`);
    result = await builder;
  } else if (type === "model") {
    let builder = auth.supabase.from("product_models").select("id,name,slug,active").eq("active", true).order("name").limit(40);
    if (query) builder = builder.or(`name.ilike.%${query}%,slug.ilike.%${query}%`);
    result = await builder;
  } else if (type === "collection") {
    let builder = auth.supabase.from("collections").select("id,name,slug,active").eq("active", true).order("name").limit(40);
    if (query) builder = builder.or(`name.ilike.%${query}%,slug.ilike.%${query}%`);
    result = await builder;
  } else if (type === "campaign") {
    let builder = auth.supabase.from("promotion_campaigns").select("id,name,status,starts_at,ends_at").in("status", ["approved", "published", "scheduled"]).order("name").limit(40);
    if (query) builder = builder.ilike("name", `%${query}%`);
    result = await builder;
  } else if (type === "review") {
    let builder = auth.supabase.from("reviews").select("id,rating,content,verified_purchase,created_at,products(name,slug)").eq("status", "approved").order("created_at", { ascending: false }).limit(30);
    if (query) builder = builder.ilike("content", `%${query}%`);
    result = await builder;
  } else if (type === "page" || type === "guide") {
    let builder = auth.supabase.from("cms_pages").select("id,title,slug,status").eq("status", "published").order("title").limit(40);
    if (query) builder = builder.or(`title.ilike.%${query}%,slug.ilike.%${query}%`);
    result = await builder;
  } else {
    return NextResponse.json({ targets: [] }, { headers: privateNoStore });
  }
  if (result.error) return NextResponse.json({ message: "Não foi possível consultar os destinos reais." }, { status: 503, headers: privateNoStore });
  const serialized = objectRows(result.data).map((row) => {
    const id = text(row, "id");
    const label = text(row, "name") || text(row, "title");
    const slug = text(row, "slug");
    const relatedProduct = objectRows(row.products)[0] ?? record(row.products) ?? {};
    const relatedSlug = text(relatedProduct, "slug");
    const route = type === "product" ? `/produto/${slug}`
      : type === "category" || type === "subcategory" ? `/produtos?categoria=${encodeURIComponent(label)}`
      : type === "model" ? `/modelos/${slug}`
      : type === "collection" ? `/produtos?colecao=${encodeURIComponent(label)}`
      : type === "campaign" ? "/ofertas"
      : type === "review" && relatedSlug ? `/produto/${relatedSlug}`
      : `/${slug}`;
    const variants = objectRows(row.product_variants);
    const firstSku = variants.length ? text(variants[0]!, "sku") : "";
    const stock = variants.reduce((sum, variant) => {
      const inventory = objectRows(variant.inventory)[0];
      const available = typeof inventory?.available_quantity === "number" ? inventory.available_quantity : 0;
      return sum + Math.max(available, 0);
    }, 0);
    const price = typeof row.base_price === "number" ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(row.base_price) : "";
    const image = objectRows(row.product_images).sort((left, right) => Number(right.is_primary === true) - Number(left.is_primary === true)).map((entry) => text(entry, "storage_path"))[0] ?? "";
    const reviewLabel = type === "review" ? `Avaliação sobre ${text(relatedProduct, "name") || "produto"}` : label;
    const reviewDetail = type === "review" ? `${text(row, "rating")} estrela(s) · ${text(row, "content").slice(0, 100)}` : "";
    return { id, label: reviewLabel, route, image, detail: type === "product" ? [firstSku, price, `${stock} disponível(is)`].filter(Boolean).join(" · ") : reviewDetail || text(row, "status") || "ativo" };
  });
  return NextResponse.json({ targets: serialized }, { headers: privateNoStore });
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("mode") === "targets") return targets(request);
  const auth = await authorizeHomepageRequest(request, "homepage.view");
  if (!auth) return unauthorizedAdminResponse();
  const permissions = await capabilities(request);
  const [sectionsResult, versionsResult, pageVersionsResult] = await Promise.all([
    auth.supabase.from("homepage_sections").select("id,internal_name,section_type,title,subtitle,description,layout,status,visibility,style_config,content_config,starts_at,ends_at,sort_order,locked,revision,current_version_id,created_by,updated_by,updated_at,home_section_items(id,item_type,internal_name,title,subtitle,description,alt_text,decorative,target_type,target_id,target_route,sort_order,config,home_section_item_media(id,media_role,storage_path,mime_type,alt_text,decorative,size_bytes))").order("sort_order").limit(100),
    auth.supabase.from("homepage_section_versions").select("id,section_id,version,status,change_summary,changed_by,approved_by,created_at").order("created_at", { ascending: false }).limit(100),
    auth.supabase.from("home_page_versions").select("id,version,status,reason,scheduled_at,published_at,created_by,created_at").order("version", { ascending: false }).limit(50)
  ]);
  if (sectionsResult.error || versionsResult.error || pageVersionsResult.error) {
    return NextResponse.json({ message: "Não foi possível carregar o construtor." }, { status: 503, headers: privateNoStore });
  }
  const sectionRows = objectRows(sectionsResult.data);
  const responsibleIds = [...new Set(sectionRows.map((row) => text(row, "updated_by") || text(row, "created_by")).filter(Boolean))];
  const profilesResult = responsibleIds.length ? await auth.supabase.from("profiles").select("id,full_name").in("id", responsibleIds) : { data: [], error: null };
  const profileNames = new Map(objectRows(profilesResult.data).map((profile) => [text(profile, "id"), text(profile, "full_name")]));
  const sections = sectionRows.map((section) => ({ ...section, responsible_name: profileNames.get(text(section, "updated_by") || text(section, "created_by")) ?? "Não informado" }));
  const [metricsResult, auditResult] = await Promise.all([
    permissions["homepage.metrics.read"] ? auth.supabase.from("home_section_metrics").select("section_version_id,item_key,metric_date,device,views,clicks").order("metric_date", { ascending: false }).limit(2000) : Promise.resolve({ data: [], error: null }),
    permissions["homepage.audit.read"] ? auth.supabase.from("home_section_audit_logs").select("id,section_id,actor_id,actor_role,action,reason,created_at").order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null })
  ]);
  return NextResponse.json({
    sections,
    versions: versionsResult.data ?? [],
    pageVersions: pageVersionsResult.data ?? [],
    metrics: metricsResult.data ?? [],
    audit: auditResult.data ?? [],
    capabilities: permissions
  }, { headers: privateNoStore });
}

export async function POST(request: NextRequest) {
  if (!safePanelOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: privateNoStore });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Revise os dados do construtor." }, { status: 400, headers: privateNoStore });
  const permission: HomepagePermission = parsed.data.action === "save" ? (parsed.data.payload.id ? "homepage.edit" : "homepage.create")
    : parsed.data.action === "reorder" || parsed.data.action === "duplicate" ? "homepage.edit"
    : parsed.data.action === "publish" || parsed.data.action === "cancel_publication" || parsed.data.action === "restore_version" || ["hide", "archive", "restore", "lock", "unlock"].includes(parsed.data.action === "transition" ? parsed.data.transition : "") ? "homepage.publish"
    : parsed.data.action === "transition" && ["approve", "reject"].includes(parsed.data.transition) ? "homepage.review"
    : "homepage.edit";
  const auth = await authorizeHomepageRequest(request, permission);
  if (!auth) return unauthorizedAdminResponse();
  let result;
  if (parsed.data.action === "save") {
    result = await auth.supabase.rpc("save_homepage_section", { p_payload: parsed.data.payload, p_expected_revision: parsed.data.expectedRevision ?? null });
  } else if (parsed.data.action === "transition") {
    result = await auth.supabase.rpc("transition_homepage_section", { p_section_id: parsed.data.sectionId, p_action: parsed.data.transition, p_reason: parsed.data.reason });
  } else if (parsed.data.action === "reorder") {
    if (parsed.data.sectionIds.length !== parsed.data.revisions.length) return NextResponse.json({ message: "A ordem informada é inválida." }, { status: 400, headers: privateNoStore });
    result = await auth.supabase.rpc("reorder_homepage_sections", { p_section_ids: parsed.data.sectionIds, p_expected_revisions: parsed.data.revisions });
  } else if (parsed.data.action === "publish") {
    result = await auth.supabase.rpc("publish_homepage", { p_reason: parsed.data.reason, p_scheduled_at: parsed.data.scheduledAt ?? null });
  } else if (parsed.data.action === "cancel_publication") {
    result = await auth.supabase.rpc("cancel_homepage_publication", { p_page_version_id: parsed.data.pageVersionId, p_reason: parsed.data.reason });
  } else {
    const version = parsed.data.action === "restore_version"
      ? await auth.supabase.from("homepage_section_versions").select("snapshot").eq("id", parsed.data.versionId).maybeSingle()
      : await auth.supabase.from("homepage_sections").select("revision,current_version_id,homepage_section_versions!homepage_sections_current_version_fkey(snapshot)").eq("id", parsed.data.sectionId).maybeSingle();
    if (version.error || !version.data) return NextResponse.json({ message: "A versão solicitada não está disponível." }, { status: 404, headers: privateNoStore });
    const source = version.data as Record<string, unknown>;
    const nested = source.homepage_section_versions;
    const snapshot = parsed.data.action === "restore_version" ? source.snapshot : Array.isArray(nested) ? (nested[0] as Record<string, unknown> | undefined)?.snapshot : (nested as Record<string, unknown> | null)?.snapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return NextResponse.json({ message: "Snapshot inválido." }, { status: 409, headers: privateNoStore });
    const rawSnapshot = snapshot as Record<string, unknown>;
    const restoredItems = Array.isArray(rawSnapshot.items) ? rawSnapshot.items.flatMap((entry: unknown) => {
      const item = record(entry);
      return item ? [{ ...item, media: Array.isArray(item.media) ? item.media : [] }] : [];
    }) : [];
    const sourceName = typeof rawSnapshot.internalName === "string" ? rawSnapshot.internalName : "Seção";
    const payload = { ...rawSnapshot, items: restoredItems, ...(parsed.data.action === "duplicate" ? { id: undefined, internalName: `${sourceName} — cópia`, sortOrder: 100, changeSummary: "Seção duplicada" } : { changeSummary: parsed.data.reason }) };
    result = await auth.supabase.rpc("save_homepage_section", { p_payload: payload, p_expected_revision: parsed.data.action === "duplicate" ? null : null });
  }
  if (result.error) {
    const message = result.error.message.includes("revision conflict") ? "Outra pessoa alterou esta seção. Recarregue antes de continuar."
      : result.error.message.includes("author cannot") ? "O autor não pode aprovar a própria alteração."
      : result.error.message.includes("unavailable") ? "Um produto, destino ou arquivo não está mais disponível."
      : result.error.message.includes("not authorized") ? "O destino externo não está autorizado."
      : "Não foi possível concluir a operação.";
    return NextResponse.json({ message }, { status: result.error.message.includes("revision conflict") ? 409 : 400, headers: privateNoStore });
  }
  return NextResponse.json({ ok: true, message: parsed.data.action === "publish" ? "Publicação registrada com segurança." : "Alteração registrada." }, { headers: privateNoStore });
}
