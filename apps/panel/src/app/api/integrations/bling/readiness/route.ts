import { BlingError } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeBlingTechnicalRequest, panelBlingClient } from "@/lib/bling-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";

const row = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const positive = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0;
const list = (v: unknown) => {
  const value = row(v).data;
  if (!Array.isArray(value)) throw new BlingError("invalid_response", 502);
  return value.map(row);
};

// Read-only provider evidence. No invoice numbers, customer details or credentials
// are returned, and no catalogue or fiscal mutations are possible in this route.
export async function GET(request: NextRequest) {
  if (!await authorizeBlingTechnicalRequest(request, { mutation: false })) return unauthorizedTechnicalResponse(request);
  const scope = request.nextUrl.searchParams.get("scope");
  const page = Number(request.nextUrl.searchParams.get("page") ?? 1);
  const series = Number(request.nextUrl.searchParams.get("series"));
  if (scope !== "catalog" && scope !== "series" || !positive(page) || page > 100
    || scope === "series" && (!positive(series) || series > 999))
    return NextResponse.json({ message: "Consulta inválida." }, { status: 400, headers: technicalNoStore });
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Integração indisponível." }, { status: 503, headers: technicalNoStore });
  const provider = panelBlingClient(db);
  try {
    if (scope === "series") {
      // The API excludes cancelled documents by default. Check those separately,
      // and both directions, without a recent-date filter hiding older numbers.
      let used = false;
      for (const type of ["0", "1"]) for (const cancelled of [false, true]) {
        const query = new URLSearchParams({ pagina: "1", limite: "1", serie: String(series), tipo: type,
          dataEmissaoInicial: "2000-01-01 00:00:00", dataEmissaoFinal: `${new Date().toISOString().slice(0, 10)} 23:59:59` });
        if (cancelled) query.set("situacao", "2");
        used = list(await provider.request(`/nfe?${query}`)).length > 0 || used;
      }
      return NextResponse.json({ series, used, includesCancelled: true, includesBothDirections: true,
        numberingChanged: false, productionHistoryVerified: false }, { headers: technicalNoStore });
    }
    const deposit = process.env.BLING_STOCK_DEPOSIT_ID;
    if (!positive(deposit)) throw new BlingError("stock_mapping_required", 409);
    const external = list(await provider.request(`/produtos?pagina=${page}&limite=100&criterio=5`));
    if (external.some((p) => !positive(p.id) || !text(p.codigo))) throw new BlingError("invalid_response", 502);
    if (!external.length) return NextResponse.json({ page, hasMore: false, rows: [] }, { headers: technicalNoStore });
    const query = new URLSearchParams();
    for (const p of external) query.append("idsProdutos[]", String(p.id));
    const balances = list(await provider.request(`/estoques/saldos/${deposit}?${query}`));
    const mapped = await db.rpc("read_bling_external_mappings", { p_external_ids: external.map((p) => Number(p.id)) });
    if (mapped.error || !Array.isArray(mapped.data)) throw new BlingError("catalog_unavailable", 503);
    const mappings = mapped.data.map(row);
    const local = await db.from("product_variants").select("id,sku,active,price_override,products!inner(base_price,status),inventory(available_quantity,reserved_quantity)")
      .in("id", mappings.map((m) => text(m.variantId)));
    if (local.error || !Array.isArray(local.data)) throw new BlingError("catalog_unavailable", 503);
    const rows = external.map((p) => {
      const mapping = mappings.find((m) => Number(m.externalProductId) === Number(p.id) && text(m.externalSku) === text(p.codigo));
      const matching = local.data.map(row).filter((v) => mapping && v.id === mapping.variantId && text(v.sku) === text(mapping.sku));
      const variant = matching[0];
      const product = row(Array.isArray(variant?.products) ? variant.products[0] : variant?.products);
      const inventory = row(Array.isArray(variant?.inventory) ? variant.inventory[0] : variant?.inventory);
      const balance = balances.filter((b) => Number(row(b.produto).id) === Number(p.id));
      const physical = Number(inventory.available_quantity) + Number(inventory.reserved_quantity);
      const observed = balance.length === 1 && balance[0]?.saldoFisicoTotal != null ? Number(balance[0].saldoFisicoTotal) : null;
      const localPrice = variant && (variant.price_override ?? product.base_price) != null ? Number(variant.price_override ?? product.base_price) : null;
      const externalPrice = p.preco == null ? null : Number(p.preco);
      const duplicate = external.filter((e) => text(e.codigo).toLowerCase() === text(p.codigo).toLowerCase()).length !== 1;
      return { sku: text(p.codigo), localSku: variant?.sku ?? null, externalProductId: Number(p.id), localVariantId: variant?.id ?? null,
        localPhysical: Number.isFinite(physical) ? physical : null, externalPhysical: observed,
        localAvailable: inventory.available_quantity ?? null, localReserved: inventory.reserved_quantity ?? null,
        stockMatches: matching.length === 1 && observed !== null && Number.isFinite(physical) && observed === physical,
        priceMatches: localPrice !== null && externalPrice !== null && Number.isFinite(localPrice) && Number.isFinite(externalPrice)
          && Math.round(localPrice * 100) === Math.round(externalPrice * 100),
        statusMatches: !!variant && p.situacao === (product.status === "active" && variant.active === true ? "A" : "I"), duplicate };
    });
    return NextResponse.json({ page, hasMore: external.length === 100, rows }, { headers: technicalNoStore });
  } catch (error) {
    return NextResponse.json({ message: "Não foi possível conferir os dados externos.",
      code: error instanceof BlingError ? error.code : "readiness_unavailable" }, { status: 503, headers: technicalNoStore });
  }
}
