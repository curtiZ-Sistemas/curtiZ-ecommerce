import { createHash } from "node:crypto";
import { BlingError } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { safeTechnicalOrigin, technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";
import { authorizeBlingTechnicalRequest, panelBlingClient } from "@/lib/bling-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

const entry = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const pageNumber = (value: unknown) => {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 10000 ? page : null;
};
type Database = NonNullable<ReturnType<typeof createServiceSupabaseClient>>;

async function preview(db: Database, page: number) {
  const result = entry(await panelBlingClient(db).request(`/produtos?pagina=${page}&limite=100&criterio=5`));
  const products = Array.isArray(result?.data) ? result.data.flatMap((value) => {
    const item = entry(value);
    const sku = typeof item?.codigo === "string" ? item.codigo.trim() : "";
    const externalProductId = Number(item?.id);
    return sku && Number.isSafeInteger(externalProductId) && externalProductId > 0
      ? [{ sku, externalProductId, name: typeof item?.nome === "string" ? item.nome : "" }] : [];
  }) : [];
  const duplicateCodes = new Set<string>();
  const seen = new Set<string>();
  for (const item of products) {
    const sku = item.sku.toLowerCase();
    if (seen.has(sku)) duplicateCodes.add(sku);
    seen.add(sku);
  }
  const local = products.length ? await db.from("product_variants").select("id,sku,active").in("sku", products.map((item) => item.sku))
    : { data: [], error: null };
  if (local.error) throw new BlingError("catalog_unavailable", 503, true);
  const localRows: unknown = local.data;
  const localBySku = new Map<string, string>(Array.isArray(localRows) ? localRows.flatMap((value: unknown) => {
    const variant = entry(value);
    return typeof variant?.sku === "string" && typeof variant.id === "string"
      ? [[variant.sku.toLowerCase(), variant.id] as [string, string]] : [];
  }) : []);
  const rows = products.map((item) => {
    const variant = localBySku.get(item.sku.toLowerCase());
    return { ...item, localVariantId: variant ?? null,
      status: duplicateCodes.has(item.sku.toLowerCase()) ? "duplicate_external_sku"
        : variant ? "ready_to_match" : "no_local_match" };
  });
  const digest = createHash("sha256").update(JSON.stringify(rows.map((item) => [item.sku, item.externalProductId, item.localVariantId]))).digest("hex");
  return { page, rows, digest, hasMore: products.length === 100 };
}

async function localPreview(db: Database, page: number) {
  const result = await db.from("product_variants").select("id,sku,active")
    .order("sku").range((page - 1) * 30, page * 30);
  if (result.error) throw new BlingError("catalog_unavailable", 503, true);
  const variants: unknown = result.data;
  const items = Array.isArray(variants) ? variants.flatMap((value: unknown) => {
    const variant = entry(value);
    return typeof variant?.id === "string" && typeof variant.sku === "string"
      ? [{ id: variant.id, sku: variant.sku, active: variant.active === true }] : [];
  }) : [];
  const links = items.length ? await db.rpc("read_bling_product_links", { p_variant_ids: items.map((item) => item.id) })
    : { data: [], error: null };
  if (links.error) throw new BlingError("catalog_unavailable", 503, true);
  const linked: unknown = links.data;
  const linkedIds = new Set(Array.isArray(linked) ? linked.flatMap((value: unknown) => {
    const link = entry(value);
    return typeof link?.variantId === "string" ? [link.variantId] : [];
  }) : []);
  return { page, rows: items.slice(0, 30).map((item) => ({ ...item, linked: linkedIds.has(item.id) })),
    hasMore: items.length > 30 };
}

export async function GET(request: NextRequest) {
  const auth = await authorizeBlingTechnicalRequest(request, { mutation: false });
  if (!auth) return unauthorizedTechnicalResponse(request);
  const page = pageNumber(request.nextUrl.searchParams.get("page"));
  const source = request.nextUrl.searchParams.get("source") ?? "bling";
  if (!page) return NextResponse.json({ message: "Página inválida." }, { status: 400, headers: technicalNoStore });
  if (!["bling", "local"].includes(source)) return NextResponse.json({ message: "Origem inválida." }, { status: 400, headers: technicalNoStore });
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Integração indisponível." }, { status: 503, headers: technicalNoStore });
  try { return NextResponse.json(await (source === "local" ? localPreview(db, page) : preview(db, page)), { headers: technicalNoStore }); }
  catch { return NextResponse.json({ message: "Não foi possível obter a prévia dos produtos." }, { status: 503, headers: technicalNoStore }); }
}

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: technicalNoStore });
  const auth = await authorizeBlingTechnicalRequest(request);
  if (!auth) return unauthorizedTechnicalResponse(request);
  const body: unknown = await request.json().catch(() => null);
  const input = entry(body);
  if (input?.action === "create") {
    if (process.env.BLING_PRODUCT_CREATE_ENABLED !== "true" || typeof input.variantId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(input.variantId))
      return NextResponse.json({ message: "Criação de produto não habilitada." }, { status: 409, headers: technicalNoStore });
    const queued = await auth.supabase.rpc("enqueue_bling_product_create", { p_variant_id: input.variantId });
    if (queued.error || queued.data !== true)
      return NextResponse.json({ message: "Produto já vinculado ou solicitação existente." }, { status: 409, headers: technicalNoStore });
    return NextResponse.json({ message: "Sincronização solicitada." }, { headers: technicalNoStore });
  }
  const page = pageNumber(input?.page);
  if (!page || typeof input?.digest !== "string" || !/^[a-f0-9]{64}$/u.test(input.digest))
    return NextResponse.json({ message: "Prévia inválida." }, { status: 400, headers: technicalNoStore });
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Integração indisponível." }, { status: 503, headers: technicalNoStore });
  try {
    const current = await preview(db, page);
    if (current.digest !== input.digest) return NextResponse.json({ message: "A página mudou. Confira a prévia novamente." },
      { status: 409, headers: technicalNoStore });
    const matches = current.rows.filter((item) => item.status === "ready_to_match")
      .map(({ sku, externalProductId }) => ({ sku, externalProductId }));
    // A duplicate SKU can be on another page. Recheck the filtered catalogue before linking.
    if (matches.length) {
      const query = new URLSearchParams({ limite: "100", criterio: "5" });
      for (const match of matches) query.append("codigos[]", match.sku);
      const found: Array<{ sku: string; id: number }> = [];
      for (let checkPage = 1; checkPage <= 20; checkPage += 1) {
        query.set("pagina", String(checkPage));
        const response = entry(await panelBlingClient(db).request(`/produtos?${query.toString()}`));
        if (!Array.isArray(response?.data)) throw new BlingError("invalid_response", 502);
        for (const value of response.data) {
          const candidate = entry(value);
          if (typeof candidate?.codigo === "string") found.push({ sku: candidate.codigo.toLowerCase(), id: Number(candidate.id) });
        }
        if (response.data.length < 100) break;
        if (checkPage === 20) throw new BlingError("catalog_too_large", 409);
      }
      for (const match of matches) {
        const candidates = found.filter((candidate) => candidate.sku === match.sku.toLowerCase());
        if (candidates.length !== 1 || candidates[0]?.id !== match.externalProductId)
          throw new BlingError("duplicate_external_sku", 409);
      }
    }
    const result = await db.rpc("match_bling_products", { p_matches: matches });
    if (result.error) throw new Error("matching_failed");
    const matched: unknown = result.data;
    if (typeof matched !== "number") throw new Error("invalid_match_count");
    await db.from("audit_logs").insert({ actor_id: auth.userId, actor_role: "technical",
      action: "integration.bling.products_matched", entity_type: "integration",
      new_data_sanitized: { provider: "bling", page, count: matched } });
    return NextResponse.json({ matched }, { headers: technicalNoStore });
  } catch { return NextResponse.json({ message: "Correspondência não concluída. Confira conflitos de SKU." },
    { status: 409, headers: technicalNoStore }); }
}
