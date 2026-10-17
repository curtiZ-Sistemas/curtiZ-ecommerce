import "server-only";
import { BlingError, createBlingClient, type BlingClient } from "./bling";

type RecordValue = Record<string, unknown>;
type Environment = Readonly<Record<string, string | undefined>>;
export type BlingCatalogRpc = (name: string, args: RecordValue) => Promise<{ data: unknown; error: unknown }>;
const row = (v: unknown): RecordValue | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : null;
const rows = (v: unknown) => Array.isArray(v) ? v.flatMap((v) => row(v) ? [row(v)!] : []) : [];
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const id = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const data = (v: unknown) => row(v)?.data;
const call = async (rpc: BlingCatalogRpc, name: string, args: RecordValue): Promise<unknown> => {
  const result = await rpc(name, args);
  if (result.error) throw new BlingError("storage_unavailable", 503, true);
  return result.data;
};

export function blingCatalogPayload(value: unknown, environment: Environment): RecordValue {
  const snapshot = row(value), variant = row(snapshot?.variant), product = row(snapshot?.product), metadata = row(snapshot?.metadata);
  if (!variant || !product) throw new BlingError("variant_unavailable", 409);
  const price = Number(variant.price_override ?? product.base_price);
  const sku = text(variant.sku);
  const name = [text(product.name), text(variant.color_name), text(variant.size)].filter(Boolean).join(" · ").slice(0, 120);
  if (!sku || !name || !Number.isFinite(price) || price < 0) throw new BlingError("invalid_product_data", 409);
  const payload: RecordValue = { nome: name, codigo: sku, preco: price, tipo: "P",
    situacao: product.status === "active" && variant.active === true ? "A" : "I", formato: "S" };
  if ([product.weight_grams, product.height_cm, product.width_cm, product.length_cm]
    .every((v) => v != null && Number.isFinite(Number(v)) && Number(v) > 0)) {
    payload.pesoBruto = Number(product.weight_grams) / 1000;
    payload.dimensoes = { altura: Number(product.height_cm), largura: Number(product.width_cm), profundidade: Number(product.length_cm), unidadeMedida: 1 };
  }
  if (metadata) {
    if (!["PR", "UN", "KIT"].includes(text(metadata.commercial_unit)) || !/^\d{8}$/u.test(text(metadata.ncm))
      || !Number.isInteger(metadata.origin) || Number(metadata.origin) < 0 || Number(metadata.origin) > 8
      || !["P", "T"].includes(text(metadata.production_type))) throw new BlingError("invalid_product_fiscal_data", 409);
    payload.unidade = metadata.commercial_unit;
    payload.tipoProducao = metadata.production_type;
    payload.tributacao = { origem: metadata.origin, ncm: metadata.ncm, cest: text(metadata.cest) };
  }
  if (text(product.short_description)) payload.descricaoCurta = text(product.short_description);
  if (/^(?:\d{8}|\d{12,14})$/u.test(text(variant.barcode))) payload.gtin = text(variant.barcode);
  // Only our public catalogue bucket is sent to the provider. Never forward arbitrary URLs.
  const imagePaths = Array.isArray(snapshot?.imagePaths) ? snapshot.imagePaths : [];
  const origin = new URL(environment.SUPABASE_URL ?? "https://invalid.invalid").origin;
  const links = imagePaths.filter((v): v is string => typeof v === "string" && /^products\/[a-zA-Z0-9/_\-.]+$/u.test(v)
    && !v.split("/").some((part) => part === "." || part === ".."));
  if (links.length) payload.midia = { imagens: { imagensURL: links.map((path) => ({
    link: `${origin}/storage/v1/object/public/catalog-public/${path.split("/").map(encodeURIComponent).join("/")}`
  })) } };
  return payload;
}

async function snapshot(rpc: BlingCatalogRpc, variantId: string) {
  const result = row(await call(rpc, "read_bling_catalog_variant", { p_variant_id: variantId }));
  if (!result) throw new BlingError("variant_unavailable", 409);
  return result;
}

export async function executeBlingCatalogJob(input: { rpc: BlingCatalogRpc; provider: Pick<BlingClient, "request">; environment: Environment;
  type: string; variantId: string }) {
  const { rpc, provider, environment, type, variantId } = input;
  const link = row(await call(rpc, "read_bling_product_link", { p_variant_id: variantId }));
  if (type === "bling.product.create" && link) return;
  if (type === "bling.stock.sync") {
    if (link?.removed === true) return;
    const externalId = id(link?.external_product_id), depositId = id(environment.BLING_STOCK_DEPOSIT_ID);
    if (!externalId || !depositId) throw new BlingError("stock_mapping_required", 409);
    const local = await snapshot(rpc, variantId), inventory = row(local.inventory);
    const physical = Number(inventory?.available_quantity) + Number(inventory?.reserved_quantity), version = id(inventory?.version);
    const cost = Number(row(local.variant)?.cost_override ?? row(local.product)?.cost_price);
    if (!inventory || !Number.isSafeInteger(physical) || physical < 0 || !version || !Number.isFinite(cost) || cost < 0)
      throw new BlingError("invalid_inventory", 409);
    const query = new URLSearchParams({ "idsProdutos[]": String(externalId) });
    const balance = () => provider.request(`/estoques/saldos/${depositId}?${query.toString()}`);
    const current = rows(data(await balance())).find((item) => id(row(item.produto)?.id) === externalId);
    if (!current || !Number.isFinite(Number(current.saldoFisicoTotal))) throw new BlingError("stock_balance_unavailable", 503, true);
    // This endpoint documents only produto.id; verify SKU against the product resource.
    const external = row(data(await provider.request(`/produtos/${externalId}`)));
    if (text(external?.codigo).toLowerCase() !== text(link?.sku).toLowerCase()) throw new BlingError("external_sku_changed", 409);
    if (Number(current.saldoFisicoTotal) !== physical || link?.last_stock_cost == null || Number(link.last_stock_cost) !== cost) {
      const latest = row((await snapshot(rpc, variantId)).inventory);
      if (Number(latest?.available_quantity) + Number(latest?.reserved_quantity) !== physical)
        throw new BlingError("inventory_changed", 409, true);
      const movementId = id(row(data(await provider.request("/estoques", { method: "POST", body: { produto: { id: externalId }, deposito: { id: depositId },
        operacao: "B", quantidade: physical, custo: cost, observacoes: "Sincronização de saldo absoluto curti Z" } })))?.id);
      if (!movementId) throw new BlingError("uncertain_write", 503, false, true);
      const movement = row(data(await provider.request(`/estoques/${movementId}`)));
      if (id(row(movement?.produto)?.id) !== externalId || id(row(movement?.deposito)?.id) !== depositId
        || Number(movement?.custo) !== cost) throw new BlingError("stock_cost_verification_failed", 503, false, true);
      const observed = rows(data(await balance())).find((item) => id(row(item.produto)?.id) === externalId);
      if (Number(observed?.saldoFisicoTotal) !== physical) throw new BlingError("stock_verification_failed", 503, true);
    }
    if (await call(rpc, "mark_bling_stock_cost_synced", { p_variant_id: variantId, p_expected_version: version, p_expected_quantity: physical, p_expected_cost: cost }) !== true)
      throw new BlingError("inventory_changed", 409, true);
    return;
  }
  if (!["bling.product.create", "bling.product.sync", "bling.product.reconcile"].includes(type)) throw new BlingError("unsupported_job", 409);
  if (type === "bling.product.sync") {
    if (!link) return;
    const externalId = id(link.external_product_id), expectedUpdatedAt = text(link.updated_at);
    if (!externalId || !expectedUpdatedAt) throw new BlingError("product_mapping_required", 409);
    try {
      const external = row(data(await provider.request(`/produtos/${externalId}`)));
      if (text(external?.codigo).toLowerCase() !== text(link.sku).toLowerCase()) throw new BlingError("external_sku_changed", 409);
      const payload = link.removed === true ? { situacao: "I" } : blingCatalogPayload(await snapshot(rpc, variantId), environment);
      await provider.request(`/produtos/${externalId}`, { method: "PATCH", body: payload });
      if (await call(rpc, "mark_bling_product_status", { p_variant_id: variantId, p_status: "synced", p_sku: text(payload.codigo) || text(link.sku),
        p_expected_updated_at: expectedUpdatedAt, p_error_code: null }) !== true) throw new BlingError("product_changed", 409, true);
    } catch (error) {
      const issue = error instanceof BlingError ? error : new BlingError("product_sync_failed", 503, true);
      await rpc("mark_bling_product_status", { p_variant_id: variantId, p_status: issue.uncertainWrite || issue.code === "external_sku_changed"
        ? "reconciliation_required" : "failed", p_sku: text(link.sku), p_expected_updated_at: expectedUpdatedAt, p_error_code: issue.code });
      throw issue;
    }
    return;
  }
  const payload = blingCatalogPayload(await snapshot(rpc, variantId), environment), sku = text(payload.codigo);
  const query = new URLSearchParams({ "codigos[]": sku, pagina: "1", limite: "100", criterio: "5" });
  const listed = rows(data(await provider.request(`/produtos?${query.toString()}`)));
  if (listed.length >= 100) throw new BlingError("ambiguous_external_sku", 409);
  const found = listed.filter((item) => text(item.codigo).toLowerCase() === sku.toLowerCase());
  if (found.length > 1) throw new BlingError("duplicate_external_sku", 409);
  let externalId = found.length ? id(found[0]?.id) : null;
  if (type === "bling.product.reconcile" && (!externalId || link && externalId !== id(link.external_product_id)))
    throw new BlingError("external_product_reconciliation_required", 409);
  if (!externalId) {
    if (!row((await snapshot(rpc, variantId)).metadata)) throw new BlingError("product_metadata_required", 409);
    externalId = id(row(data(await provider.request("/produtos", { method: "POST", body: payload })))?.id);
    if (!externalId) throw new BlingError("uncertain_write", 503, false, true);
  }
  await call(rpc, "match_bling_products", { p_matches: [{ sku, externalProductId: externalId }] });
  if (type === "bling.product.reconcile" && await call(rpc, "confirm_bling_product_reconciliation", {
    p_variant_id: variantId, p_external_product_id: externalId, p_sku: sku }) !== true) throw new BlingError("product_mapping_required", 409);
}

export async function runBlingCatalogBatch(environment: Environment, rpc: BlingCatalogRpc, limit = 4) {
  let processed = 0, failed = 0;
  const errors: string[] = [];
  if (!environment.BLING_CLIENT_ID || !environment.BLING_CLIENT_SECRET || !environment.BLING_TOKEN_ENCRYPTION_KEY)
    throw new BlingError("configuration", 503);
  for (let index = 0; index < Math.min(Math.max(limit, 1), 8); index += 1) {
    const lockId = crypto.randomUUID();
    const job = row(await call(rpc, "claim_bling_catalog_job", { p_lock_id: lockId,
      p_create_enabled: environment.BLING_PRODUCT_CREATE_ENABLED === "true", p_product_enabled: environment.BLING_PRODUCT_SYNC_ENABLED === "true",
      p_stock_enabled: environment.BLING_STOCK_SYNC_ENABLED === "true" }));
    if (!job) break;
    const provider = createBlingClient(environment, rpc, async (input, init) => {
      if (await call(rpc, "renew_bling_job_lease", { p_job_id: job.id, p_lock_id: lockId }) !== true) throw new BlingError("job_lease_lost", 409);
      return fetch(input, init);
    });
    try {
      await executeBlingCatalogJob({ rpc, provider, environment, type: text(job.jobType), variantId: text(row(job.payload)?.variantId) });
      if (await call(rpc, "finish_bling_job", { p_job_id: job.id, p_lock_id: lockId, p_outcome: "completed", p_error_code: null }) !== true)
        throw new BlingError("job_lease_lost", 409);
      processed += 1;
    } catch (error) {
      const issue = error instanceof BlingError ? error : new BlingError("catalog_batch_failed", 503, true);
      failed += 1; errors.push(issue.code);
      if (issue.code !== "job_lease_lost") await call(rpc, "finish_bling_job", { p_job_id: job.id, p_lock_id: lockId,
        p_outcome: issue.retryable && !issue.uncertainWrite ? "retry" : "failed", p_error_code: issue.code,
        p_retry_after_ms: Math.min(Math.max(Math.ceil(issue.retryAfterMs), 0), 86_400_000) });
      break;
    }
  }
  return { ok: failed === 0, processed, failed, errors };
}
