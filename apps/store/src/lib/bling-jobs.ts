import { type BlingClient, BlingError, blingExternalSku, blingFiscalMirrorHash, buildBlingOrderFiscalMirror, createBlingClient, executeBlingCatalogJob } from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";
import { decryptPII } from "@curtiz/security/pii";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isUnknownRecord, readNumber, readString } from "./unknown-data";
import { archiveBlingInvoice, ensureBlingFiscalApproval, resolveBlingOrderNature } from "./bling-fiscal-automation";
import { prepareBlingFiscalDraft } from "./bling-invoice-draft";
import { assertBlingB2CRecipient, readBlingFiscalRecipient } from "./bling-fiscal-scope";

type Environment = Readonly<Record<string, string | undefined>>;
type Job = { id: string; type: "bling.order.create" | "bling.order.reconcile" | "bling.webhook.reconcile" | "bling.invoice.generate" | "bling.invoice.send" | "bling.invoice.poll" | "bling.invoice.archive" | "bling.invoice.email" | "bling.product.sync" | "bling.product.create" | "bling.product.reconcile" | "bling.stock.sync";
  payload: Record<string, unknown>; attempts: number };
const row = (value: unknown): Record<string, unknown> | null => isUnknownRecord(value) ? value : null;
const array = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(isUnknownRecord) : [];
const idNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
const date = (value: unknown) => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new BlingError("missing_paid_date", 409);
  return new Date(value).toISOString().slice(0, 10);
};
const cents = (value: unknown) => Math.round(Number(value) * 100);
const validAmount = (value: unknown) => Number.isFinite(Number(value)) && Number(value) >= 0;
const data = (value: unknown) => row(value)?.data;

export function assertBlingPaidOrder(order: Record<string, unknown>): void {
  if (order.payment_status !== "approved" || ["pending_payment", "cancelled", "refunded", "manual_review", "cancellation_requested", "refund_pending"].includes(readString(order, "status")))
    throw new BlingError("order_not_eligible", 409);
}

function database(environment: Environment, transport: typeof fetch): SupabaseClient | null {
  const secret = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  try {
    const url = new URL(environment.SUPABASE_URL?.trim() ?? "");
    if (!secret || url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return createClient(url.origin, secret, { global: { fetch: transport }, auth: { autoRefreshToken: false, persistSession: false } });
  } catch { return null; }
}

async function call(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await db.rpc(name, args);
  if (result.error) {
    const code = row(result.error)?.code;
    logServerEvent("error", "bling_storage_request_failed", { rpc: name, status: result.status,
      databaseCode: typeof code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/u.test(code) ? code : "unknown" });
    throw new BlingError("storage_unavailable", 503, true);
  }
  return result.data;
}

async function findContact(provider: BlingClient, cpf: string): Promise<number | null> {
  const result = await provider.request(`/contatos?numeroDocumento=${encodeURIComponent(cpf)}&pagina=1&limite=100`);
  const matches = array(data(result)).filter((item) => readString(item, "numeroDocumento").replace(/\D/gu, "") === cpf);
  if (matches.length > 1) throw new BlingError("duplicate_contact", 409);
  return matches.length ? idNumber(matches[0]?.id) : null;
}

async function findOrder(provider: BlingClient, code: string): Promise<number | null> {
  const query = new URLSearchParams({ "numerosLojas[]": code, pagina: "1", limite: "100" });
  const result = await provider.request(`/pedidos/vendas?${query.toString()}`);
  const matches = array(data(result)).filter((item) => readString(item, "numeroLoja") === code);
  if (matches.length > 1) throw new BlingError("duplicate_external_order", 409);
  return matches.length ? idNumber(matches[0]?.id) : null;
}

export function blingOrderPayload(input: { order: Record<string, unknown>; items: Record<string, unknown>[];
  productLinks: Record<string, unknown>[]; contactId: number; paymentMethodId: number; natureId?: number }) {
  const { order, items, productLinks, contactId, paymentMethodId } = input;
  assertBlingPaidOrder(order);
  const code = readString(order, "public_code");
  const money = ["subtotal", "discount_total", "shipping_total", "fee_total", "grand_total"];
  if (!code || !items.length || money.some((key) => !validAmount(order[key])) || cents(order.fee_total) !== 0)
    throw new BlingError("invalid_order_snapshot", 409);
  const lineSum = items.reduce((sum, item) => sum + cents(item.unit_price) * readNumber(item, "quantity"), 0);
  const subtotal = cents(order.subtotal);
  const discount = cents(order.discount_total);
  const shipping = cents(order.shipping_total);
  const total = cents(order.grand_total);
  if (lineSum !== subtotal || total !== subtotal - discount + shipping || !contactId || !paymentMethodId)
    throw new BlingError("invalid_order_totals", 409);
  const products = items.map((item) => {
    const variantId = readString(item, "variant_id");
    const sku = readString(item, "sku_snapshot");
    const link = productLinks.find((candidate) => readString(candidate, "variantId") === variantId);
    const externalId = idNumber(link?.externalProductId);
    const unit = readString(link ?? {}, "commercialUnit");
    const quantity = readNumber(item, "quantity");
    if (!externalId || readString(link ?? {}, "sku").toLowerCase() !== sku.toLowerCase() || !sku || !validAmount(item.unit_price)
      || !Number.isSafeInteger(quantity) || quantity <= 0 || cents(item.total) !== cents(item.unit_price) * quantity
      || cents(item.discount_amount) !== 0 || !["PR", "UN", "KIT"].includes(unit))
      throw new BlingError("product_mapping_required", 409);
    return { codigo: blingExternalSku(sku, variantId), unidade: unit, quantidade: quantity, valor: Number(item.unit_price),
      descricao: readString(item, "product_name_snapshot"), produto: { id: externalId },
      ...(input.natureId ? { naturezaOperacao: { id: input.natureId } } : {}) };
  });
  const paidDate = date(order.placed_at);
  const address = row(order.shipping_address_snapshot);
  if (!address || !readString(address, "street") || !readString(address, "city")
    || !/^\d{8}$/u.test(readString(address, "postal_code").replace(/\D/gu, "")))
    throw new BlingError("shipping_address_required", 409);
  return { numeroLoja: code, data: paidDate, contato: { id: contactId }, itens: products,
    parcelas: [{ dataVencimento: paidDate, valor: total / 100, formaPagamento: { id: paymentMethodId } }],
    ...(discount > 0 ? { desconto: { valor: discount / 100, unidade: "REAL" } } : {}),
    transporte: { frete: shipping / 100, etiqueta: {
      nome: readString(order, "customer_name_snapshot"), endereco: readString(address, "street"),
      numero: readString(address, "number"), complemento: readString(address, "complement"),
      bairro: readString(address, "district"), municipio: readString(address, "city"),
      uf: readString(address, "state"), cep: readString(address, "postal_code").replace(/\D/gu, "")
    } } };
}

export function assertBlingExternalOrder(order: Record<string, unknown>, items: Record<string, unknown>[], external: Record<string, unknown> | null): void {
  const externalItems = array(external?.itens);
  const localLines = items.map((item) => JSON.stringify([blingExternalSku(readString(item, "sku_snapshot"), readString(item, "variant_id")).toLowerCase(), Number(item.quantity), cents(item.unit_price)])).sort();
  const externalLines = externalItems.map((item) => JSON.stringify([readString(item, "codigo").toLowerCase(), Number(item.quantidade), cents(item.valor)])).sort();
  if (!external || !items.length || readString(external, "numeroLoja") !== readString(order, "public_code")
    || !validAmount(external.total) || cents(external.total) !== cents(order.grand_total)
    || JSON.stringify(localLines) !== JSON.stringify(externalLines))
    throw new BlingError("external_order_mismatch", 409, false, true);
}

async function confirmOrderReconciliation(db: SupabaseClient, provider: BlingClient, orderId: string, external: Record<string, unknown>) {
  const invoiceId = idNumber(row(external.notaFiscal)?.id);
  if (invoiceId) {
    if (await call(db, "save_bling_invoice_draft", { p_order_id: orderId, p_invoice_id: invoiceId }) !== true)
      throw new BlingError("invoice_link_conflict", 409);
    await observeInvoice(db, provider, invoiceId);
  }
  if (await call(db, "confirm_bling_order_reconciliation", { p_order_id: orderId }) !== true)
    throw new BlingError("order_not_eligible", 409);
}

async function createOrder(db: SupabaseClient, provider: BlingClient, environment: Environment, orderId: string, reconcileOnly = false) {
  const [orderResult, itemsResult, linkResult] = await Promise.all([
    db.from("orders").select("id,public_code,status,payment_status,customer_id,cpf_ciphertext,customer_name_snapshot,customer_email_snapshot,customer_phone_snapshot,shipping_address_snapshot,subtotal,discount_total,shipping_total,fee_total,grand_total,placed_at")
      .eq("id", orderId).maybeSingle(),
    db.from("order_items").select("variant_id,sku_snapshot,product_name_snapshot,quantity,unit_price,discount_amount,total")
      .eq("order_id", orderId),
    call(db, "read_bling_order_link", { p_order_id: orderId })
  ]);
  if (orderResult.error || itemsResult.error) throw new BlingError("storage_unavailable", 503, true);
  const order = row(orderResult.data);
  if (!order) throw new BlingError("order_not_eligible", 409);
  assertBlingPaidOrder(order);
  const linked = row(linkResult);
  if (linked?.erp_status === "reconciliation_required" && !reconcileOnly)
    throw new BlingError("reconciliation_required", 409, false, true);
  const externalId = idNumber(linked?.external_order_id);
  if (externalId) {
    if (reconcileOnly) {
      const external = row(data(await provider.request(`/pedidos/vendas/${externalId}`)));
      assertBlingExternalOrder(order, array(itemsResult.data), external);
      if (!external) throw new BlingError("external_order_mismatch", 409);
      await confirmOrderReconciliation(db, provider, orderId, external);
    }
    return;
  }
  if (!reconcileOnly) assertBlingB2CRecipient(await readBlingFiscalRecipient(db, orderId));
  const code = readString(order, "public_code");
  const items = array(itemsResult.data);
  if (!items.length) throw new BlingError("missing_order_items", 409);
  const links = await call(db, "read_bling_product_links", { p_variant_ids: items.map((item) => readString(item, "variant_id")) });
  const cpf = typeof order.cpf_ciphertext === "string"
    ? decryptPII(order.cpf_ciphertext, environment.PII_ENCRYPTION_KEY) : "";
  if (!/^\d{11}$/u.test(cpf)) throw new BlingError("customer_identity_required", 409);
  const address = row(order.shipping_address_snapshot);
  if (!address || ["street", "number", "district", "city", "state"].some((key) => !readString(address, key))
    || !/^\d{8}$/u.test(readString(address, "postal_code").replace(/\D/gu, ""))) throw new BlingError("shipping_address_required", 409);
  const paymentMethodId = idNumber(environment.BLING_PAYMENT_METHOD_ID);
  if (!paymentMethodId) throw new BlingError("payment_method_required", 409);
  // Validate the entire immutable order before any external mutation.
  blingOrderPayload({ order, items, productLinks: array(links), contactId: 1, paymentMethodId });
  const existing = await findOrder(provider, code);
  if (existing) {
    const external = row(data(await provider.request(`/pedidos/vendas/${existing}`)));
    assertBlingExternalOrder(order, items, external);
    if (!external) throw new BlingError("external_order_mismatch", 409);
    const saved = await call(db, "save_bling_order_link", { p_order_id: orderId,
      p_external_order_id: existing, p_external_contact_id: idNumber(row(external.contato)?.id) });
    if (saved !== true) throw new BlingError("order_link_conflict", 409);
    if (reconcileOnly) await confirmOrderReconciliation(db, provider, orderId, external);
    return;
  }
  if (reconcileOnly) throw new BlingError("external_record_not_found", 409);
  const natureId = environment.BLING_FISCAL_READY === "true" ? await resolveBlingOrderNature(db, order, items) : undefined;
  let contactId = await findContact(provider, cpf);
  if (!contactId) {
    const contactResult = await provider.request("/contatos", { method: "POST", body: {
      nome: readString(order, "customer_name_snapshot"), situacao: "A", tipo: "F", numeroDocumento: cpf,
      email: readString(order, "customer_email_snapshot"), celular: readString(order, "customer_phone_snapshot"),
      endereco: { geral: { endereco: readString(address, "street"), numero: readString(address, "number"),
        complemento: readString(address, "complement"), bairro: readString(address, "district"),
        municipio: readString(address, "city"), uf: readString(address, "state"),
        cep: readString(address, "postal_code").replace(/\D/gu, "") } }
    } });
    contactId = idNumber(row(data(contactResult))?.id);
    if (!contactId) throw new BlingError("uncertain_write", 503, false, true);
  }
  const payload = blingOrderPayload({ order, items, productLinks: array(links), contactId, paymentMethodId, natureId });
  if (await call(db, "assert_bling_order_writable", { p_order_id: orderId }) !== true)
    throw new BlingError("order_not_eligible", 409);
  const created = await provider.request("/pedidos/vendas", { method: "POST", body: payload });
  const externalOrderId = idNumber(row(data(created))?.id);
  if (!externalOrderId) throw new BlingError("uncertain_write", 503, false, true);
  const saved = await call(db, "save_bling_order_link", { p_order_id: orderId,
    p_external_order_id: externalOrderId, p_external_contact_id: contactId });
  if (saved !== true) throw new BlingError("order_link_conflict", 409);
}

async function observeInvoice(db: SupabaseClient, provider: BlingClient, invoiceId: number): Promise<void> {
  const observedAt = new Date().toISOString();
  const result = row(data(await provider.request(`/nfe/${invoiceId}`)));
  if (!result) throw new BlingError("invalid_invoice_response", 502);
  const code = readString(result, "numeroPedidoLoja");
  if (!code) throw new BlingError("invoice_order_unlinked", 409);
  const linked = await call(db, "observe_bling_invoice", { p_invoice_id: invoiceId, p_order_code: code,
    p_situation: Number(result.situacao), p_invoice_number: readString(result, "numero"),
    p_access_key: readString(result, "chaveAcesso"), p_observed_at: observedAt });
  if (linked !== true) throw new BlingError("invoice_order_unlinked", 409);
}

type FiscalInvoiceItem = { sku: string; unit: string; quantity: number; unitPriceInCents: number; ncm: string; origin: number; cest: string; cfop: string };

export function assertBlingInvoiceItems(invoice: Record<string, unknown>, expected: FiscalInvoiceItem[], totals: { totalInCents: number; shippingInCents: number }) {
  const expectedLines = expected.map((item) => JSON.stringify([item.sku, item.unit, item.quantity, item.unitPriceInCents,
    item.ncm, item.origin, item.cest, item.cfop])).sort();
  const actualLines = array(invoice.itens).map((item) => JSON.stringify([readString(item, "codigo"), readString(item, "unidade"),
    Number(item.quantidade), cents(item.valor), readString(item, "classificacaoFiscal").replace(/\D/gu, ""), Number(item.origem),
    readString(item, "cest").replace(/\D/gu, ""), readString(item, "cfop")])).sort();
  if (!expected.length || JSON.stringify(expectedLines) !== JSON.stringify(actualLines)
    || !validAmount(invoice.valorNota) || !validAmount(invoice.valorFrete)
    || cents(invoice.valorNota) !== totals.totalInCents || cents(invoice.valorFrete) !== totals.shippingInCents)
    throw new BlingError("invoice_items_mismatch", 409);
}

export function assertBlingInvoiceRecipient(invoice: Record<string, unknown>, expected: { document: string; state: string; postalCode: string; icmsTaxpayer: boolean }) {
  const contact = row(invoice.contato), address = row(contact?.endereco);
  if (!/^\d{11}$/u.test(expected.document) || readString(contact ?? {}, "numeroDocumento").replace(/\D/gu, "") !== expected.document
    || readString(address ?? {}, "uf").toUpperCase() !== expected.state.toUpperCase()
    || readString(address ?? {}, "cep").replace(/\D/gu, "") !== expected.postalCode.replace(/\D/gu, "")
    || expected.icmsTaxpayer && !readString(contact ?? {}, "ie"))
    throw new BlingError("invoice_recipient_mismatch", 409);
}

async function fiscalPreconditions(db: SupabaseClient, provider: BlingClient, environment: Environment,
  orderId: string): Promise<{ externalOrderId: number; invoiceId: number | null; natureId: number; series: number; cfop: string;
    expectedItems: FiscalInvoiceItem[]; totalInCents: number; shippingInCents: number;
    expectedRecipient: { document: string; state: string; postalCode: string; icmsTaxpayer: boolean };
    mirror: Awaited<ReturnType<typeof buildBlingOrderFiscalMirror>>; commercialItems: Array<{ sku: string; unit: string; quantity: number; unitPriceInCents: number }> }> {
  if (environment.BLING_FISCAL_READY !== "true") throw new BlingError("fiscal_not_ready", 409);
  const [orderResult, itemsResult, linkValue, accountValue] = await Promise.all([
    db.from("orders").select("id,payment_status,status,customer_id,customer_name_snapshot,customer_email_snapshot,cpf_ciphertext,shipping_address_snapshot,shipping_total,discount_total,fee_total,grand_total").eq("id", orderId).maybeSingle(),
    db.from("order_items").select("variant_id,sku_snapshot,product_name_snapshot,quantity,unit_price").eq("order_id", orderId),
    call(db, "read_bling_order_link", { p_order_id: orderId }),
    call(db, "read_bling_account", { p_environment: environment.APP_ENV === "production" ? "production" : "sandbox" })
  ]);
  if (orderResult.error || itemsResult.error) throw new BlingError("storage_unavailable", 503, true);
  const order = row(orderResult.data);
  const link = row(linkValue);
  if (["uncertain_write", "lease_expired_reconciliation_required"].includes(readString(link ?? {}, "last_error_code")))
    throw new BlingError("reconciliation_required", 409, false, true);
  const externalOrderId = idNumber(link?.external_order_id);
  if (!order || order.payment_status !== "approved" || ["cancelled", "refunded", "manual_review", "cancellation_requested", "refund_pending"].includes(readString(order, "status"))
    || link?.erp_status !== "synced" || !externalOrderId || !row(accountValue)?.companyId) throw new BlingError("fiscal_precondition_failed", 409);
  const items = array(itemsResult.data);
  if (!items.length) throw new BlingError("missing_order_items", 409);
  const approval = await ensureBlingFiscalApproval(db, order, items);
  if (!approval || typeof approval.icms_taxpayer !== "boolean" || typeof approval.final_consumer !== "boolean")
    throw new BlingError("fiscal_mirror_approval_required", 409);
  const snapshots: Record<string, unknown>[] = [];
  for (const item of items) snapshots.push(row(await call(db, "read_bling_catalog_variant", { p_variant_id: item.variant_id })) ?? {});
  const mirror = await buildBlingOrderFiscalMirror({ rules: await call(db, "read_bling_fiscal_rules", {}), order, items, snapshots,
    icmsTaxpayer: approval.icms_taxpayer, finalConsumer: approval.final_consumer });
  if (mirror.blockers.includes("kit_fiscal_unit_confirmation_required")) throw new BlingError("kit_fiscal_unit_confirmation_required", 409);
  if (mirror.blockers.includes("kit_fiscal_composition_required")) throw new BlingError("kit_fiscal_composition_required", 409);
  if (mirror.blockers.includes("fiscal_tax_codes_required")) throw new BlingError("fiscal_tax_codes_required", 409);
  if (mirror.blockers.includes("fiscal_tax_parameters_required")) throw new BlingError("fiscal_tax_parameters_required", 409);
  if (await blingFiscalMirrorHash(mirror) !== approval.mirror_hash) throw new BlingError("fiscal_mirror_changed", 409);
  // Recheck for both generation and transmission: the provider settings may have
  // changed since a kit draft was prepared, including a manually prepared draft.
  if (mirror.items.some(i => i.sourceCommercialSku) && environment.BLING_INVOICE_STOCK_AUTOMATION_DISABLED !== "true")
    throw new BlingError("invoice_stock_automation_must_be_disabled", 409);
  const natureId = idNumber(mirror.rule.external_nature_id);
  if (!natureId) throw new BlingError("nature_required", 409);
  const company = row(data(await provider.request("/empresas/me/dados-basicos")));
  if (!company || String(company.id) !== String(row(accountValue)?.companyId)
    || !/^\d{14}$/u.test(readString(company, "cnpj").replace(/\D/gu, "")))
    throw new BlingError("company_fiscal_data_required", 409);
  let natureFound = false;
  for (let page = 1; page <= 20; page += 1) {
    const natureResult = array(data(await provider.request(`/naturezas-operacoes?pagina=${page}&limite=100&situacao=1`)));
    if (natureResult.some((item) => idNumber(item.id) === natureId)) { natureFound = true; break; }
    if (natureResult.length < 100) break;
  }
  if (!natureFound) throw new BlingError("nature_not_active", 409);
  const links = array(await call(db, "read_bling_product_links", { p_variant_ids: items.map((item) => readString(item, "variant_id")) }));
  for (const item of items) {
    const externalId = idNumber(links.find((linkRow) => readString(linkRow, "variantId") === readString(item, "variant_id"))?.externalProductId);
    if (!externalId) throw new BlingError("product_mapping_required", 409);
    const product = row(data(await provider.request(`/produtos/${externalId}`)));
    const snapshot = snapshots.find(s => row(s.variant)?.id === item.variant_id);
    const metadata = row(snapshot?.metadata);
    const approvedItem = metadata ? { sku: readString(item, "sku_snapshot"), unit: readString(metadata, "commercial_unit"),
      ncm: readString(metadata, "ncm"), origin: Number(metadata.origin), cest: readString(metadata, "cest") } : null;
    const tax = row(product?.tributacao);
    if (!product || product.situacao !== "A" || !approvedItem
      || readString(product, "codigo") !== blingExternalSku(approvedItem.sku, readString(item, "variant_id")) || readString(product, "unidade") !== approvedItem.unit
      || readString(tax ?? {}, "ncm").replace(/\D/gu, "") !== approvedItem.ncm || Number(tax?.origem) !== approvedItem.origin
      || readString(tax ?? {}, "cest").replace(/\D/gu, "") !== approvedItem.cest)
      throw new BlingError("product_fiscal_data_required", 409);
  }
  const expectedItems = mirror.items.map((item) => ({ sku: item.sourceCommercialSku ? item.sku : blingExternalSku(item.sku, item.variantId ?? ""),
    unit: item.unit, quantity: item.quantity, unitPriceInCents: item.unitPriceInCents, ncm: item.ncm, origin: item.origin, cest: item.cest, cfop: mirror.rule.cfop }));
  const address = row(order.shipping_address_snapshot) ?? {};
  const expectedRecipient = { document: typeof order.cpf_ciphertext === "string" ? decryptPII(order.cpf_ciphertext, environment.PII_ENCRYPTION_KEY) : "",
    state: readString(address, "state"), postalCode: readString(address, "postal_code"), icmsTaxpayer: approval.icms_taxpayer };
  const commercialItems = items.map(i => ({ sku: blingExternalSku(readString(i, "sku_snapshot"), readString(i, "variant_id")),
    unit: readString(links.find(l => readString(l, "variantId") === i.variant_id) ?? {}, "commercialUnit"), quantity: Number(i.quantity), unitPriceInCents: cents(i.unit_price) }));
  return { externalOrderId, invoiceId: idNumber(link?.invoice_id), natureId, series: mirror.rule.series, cfop: mirror.rule.cfop, expectedRecipient, mirror, commercialItems,
    expectedItems, totalInCents: mirror.totalInCents, shippingInCents: mirror.shippingInCents };
}

async function generateInvoice(db: SupabaseClient, provider: BlingClient, environment: Environment, orderId: string) {
  if (environment.BLING_INVOICE_SYNC_ENABLED !== "true") throw new BlingError("invoice_sync_disabled", 409);
  const preconditions = await fiscalPreconditions(db, provider, environment, orderId);
  const { externalOrderId, invoiceId, natureId } = preconditions;
  const prepare = (id: number) => prepareBlingFiscalDraft(provider, id, preconditions.mirror.items, preconditions.commercialItems,
    { ...preconditions.expectedRecipient, natureId, totalInCents: preconditions.totalInCents, shippingInCents: preconditions.shippingInCents,
      discountInCents: preconditions.mirror.discountInCents, additionalInCents: preconditions.mirror.additionalInCents },
    environment.BLING_INVOICE_STOCK_AUTOMATION_DISABLED === "true",
    async () => await call(db, "assert_bling_order_writable", { p_order_id: orderId }) === true);
  if (invoiceId) { await prepare(invoiceId); return; }
  const externalOrder = row(data(await provider.request(`/pedidos/vendas/${externalOrderId}`)));
  const existingInvoiceId = idNumber(row(externalOrder?.notaFiscal)?.id);
  if (!existingInvoiceId && (!array(externalOrder?.itens).length
    || array(externalOrder?.itens).some(item => idNumber(row(item.naturezaOperacao)?.id) !== natureId)))
    throw new BlingError("order_nature_mismatch", 409);
  if (!existingInvoiceId && await call(db, "assert_bling_order_writable", { p_order_id: orderId }) !== true)
    throw new BlingError("order_not_eligible", 409);
  const id = existingInvoiceId ?? idNumber(row(await provider.request(`/pedidos/vendas/${externalOrderId}/gerar-nfe`,
    { method: "POST" }))?.idNotaFiscal);
  if (!id) throw new BlingError("uncertain_write", 503, false, true);
  const saved = await call(db, "save_bling_invoice_draft", { p_order_id: orderId, p_invoice_id: id });
  if (saved !== true) throw new BlingError("invoice_link_conflict", 409);
  await prepare(id);
  await observeInvoice(db, provider, id);
}

async function sendInvoice(db: SupabaseClient, provider: BlingClient, environment: Environment, orderId: string) {
  if (environment.BLING_INVOICE_SEND_ENABLED !== "true") throw new BlingError("invoice_send_disabled", 409);
  if (!["homologation", "production"].includes(environment.BLING_INVOICE_TRANSMISSION_MODE ?? ""))
    throw new BlingError("invoice_environment_required", 409);
  if (environment.BLING_INVOICE_TRANSMISSION_MODE === "production" && environment.BLING_LIVE_INVOICE_SEND_AUTHORIZED !== "true")
    throw new BlingError("live_invoice_not_authorized", 409);
  const { invoiceId, natureId, series, cfop, expectedItems, totalInCents, shippingInCents, expectedRecipient } = await fiscalPreconditions(db, provider, environment, orderId);
  if (!invoiceId) throw new BlingError("invoice_draft_required", 409);
  const invoice = row(data(await provider.request(`/nfe/${invoiceId}`)));
  const situation = Number(invoice?.situacao);
  if (idNumber(row(invoice?.naturezaOperacao)?.id) !== natureId)
    throw new BlingError("invoice_nature_mismatch", 409);
  if (Number(invoice?.serie) !== series || !array(invoice?.itens).length || array(invoice?.itens).some((item) => item.cfop !== cfop))
    throw new BlingError("invoice_fiscal_scenario_mismatch", 409);
  if (!invoice) throw new BlingError("invoice_draft_required", 409);
  assertBlingInvoiceItems(invoice, expectedItems, { totalInCents, shippingInCents });
  assertBlingInvoiceRecipient(invoice, expectedRecipient);
  if (situation === 5 || situation === 6) { await observeInvoice(db, provider, invoiceId); return; }
  if (situation !== 1) throw new BlingError("invoice_not_sendable", 409);
  if (await call(db, "assert_bling_order_writable", { p_order_id: orderId }) !== true)
    throw new BlingError("order_not_eligible", 409);
  await provider.request(`/nfe/${invoiceId}/enviar?enviarEmail=false`, { method: "POST" });
  await observeInvoice(db, provider, invoiceId);
}

async function reconcileWebhook(db: SupabaseClient, provider: BlingClient, eventId: string) {
  const event = row(await call(db, "read_bling_webhook_event", { p_event_id: eventId }));
  if (!event || event.status === "processed" || event.status === "ignored") return;
  const type = readString(event, "event_type");
  const resourceId = idNumber(event.resource_id);
  let status = "ignored";
  if (resourceId && type.startsWith("invoice.") && !type.endsWith(".deleted")) {
    await observeInvoice(db, provider, resourceId);
    status = "processed";
  } else if (resourceId && type.startsWith("order.") && !type.endsWith(".deleted")) {
    const order = row(data(await provider.request(`/pedidos/vendas/${resourceId}`)));
    const invoiceId = idNumber(row(order?.notaFiscal)?.id);
    if (invoiceId) await observeInvoice(db, provider, invoiceId);
    status = "processed";
  }
  await call(db, "finish_bling_webhook_event", { p_event_id: eventId, p_status: status, p_error_code: null });
}

export async function runBlingJobs(environment: Environment, executionId: string, limit = 4, transport: typeof fetch = fetch) {
  const targetOrderId = environment.BLING_HOMOLOGATION_ORDER_ID;
  if (targetOrderId !== undefined && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(targetOrderId)
    || environment.BLING_INVOICE_TRANSMISSION_MODE !== "homologation"
    || environment.BLING_LIVE_INVOICE_SEND_AUTHORIZED === "true")) return { ok: false, processed: 0 };
  const db = database(environment, transport);
  if (!db || !environment.BLING_CLIENT_ID || !environment.BLING_CLIENT_SECRET || !environment.BLING_TOKEN_ENCRYPTION_KEY)
    return { ok: false, processed: 0 };
  const credential = row(await call(db, "read_integration_credential", {
    p_provider: "bling", p_environment: environment.APP_ENV === "production" ? "production" : "sandbox"
  }));
  if (credential?.status !== "connected") return { ok: false, processed: 0 };
  if (!targetOrderId) await call(db, "set_bling_shipping_policy", { p_required: environment.BLING_REQUIRE_INVOICE_FOR_SHIPPING === "true" });
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < Math.min(Math.max(limit, 1), 8); index += 1) {
    const lockId = crypto.randomUUID();
    const claimed = row(await call(db, targetOrderId ? "claim_bling_order_job" : "claim_bling_job", { p_lock_id: lockId,
      ...(targetOrderId ? { p_order_id: targetOrderId } : {}),
      p_order_enabled: environment.BLING_ORDER_SYNC_ENABLED === "true",
      p_invoice_enabled: environment.BLING_INVOICE_SYNC_ENABLED === "true",
      p_send_enabled: environment.BLING_INVOICE_SEND_ENABLED === "true",
      p_product_enabled: environment.BLING_PRODUCT_SYNC_ENABLED === "true",
      p_create_enabled: environment.BLING_PRODUCT_CREATE_ENABLED === "true",
      p_stock_enabled: environment.BLING_STOCK_SYNC_ENABLED === "true",
      p_email_enabled: false }));
    if (!claimed) break;
    const job: Job = { id: readString(claimed, "id"), type: readString(claimed, "jobType") as Job["type"],
      payload: row(claimed.payload) ?? {}, attempts: readNumber(claimed, "attempts") };
    if (targetOrderId && (readString(job.payload, "orderId") !== targetOrderId
      || !["bling.order.create", "bling.order.reconcile", "bling.invoice.generate", "bling.invoice.send", "bling.invoice.poll", "bling.invoice.archive"].includes(job.type)))
      return { ok: false, processed, failed: failed + 1 };
    const provider = createBlingClient(environment, async (name, args) => db.rpc(name, args), async (input, init) => {
      if (await call(db, "renew_bling_job_lease", { p_job_id: job.id, p_lock_id: lockId }) !== true)
        throw new BlingError("job_lease_lost", 409);
      return transport(input, init);
    });
    try {
      if (job.type === "bling.order.create") {
        if (environment.BLING_ORDER_SYNC_ENABLED !== "true") {
          await call(db, "finish_bling_job", { p_job_id: job.id, p_lock_id: lockId,
            p_outcome: "retry", p_error_code: "order_sync_disabled" });
          break;
        }
        await createOrder(db, provider, environment, readString(job.payload, "orderId"));
      } else if (job.type === "bling.order.reconcile") {
        await createOrder(db, provider, environment, readString(job.payload, "orderId"), true);
      } else if (job.type === "bling.invoice.generate") {
        await generateInvoice(db, provider, environment, readString(job.payload, "orderId"));
      } else if (job.type === "bling.invoice.send") {
        await sendInvoice(db, provider, environment, readString(job.payload, "orderId"));
      } else if (job.type === "bling.invoice.poll" || job.type === "bling.invoice.archive") {
        const orderId = readString(job.payload, "orderId");
        const link = row(await call(db, "read_bling_order_link", { p_order_id: orderId }));
        const invoiceId = idNumber(link?.invoice_id);
        if (!invoiceId) throw new BlingError("invoice_draft_required", 409);
        await observeInvoice(db, provider, invoiceId);
        const current = row(await call(db, "read_bling_order_link", { p_order_id: orderId }));
        if (job.type === "bling.invoice.archive") {
          const key = readString(current ?? {}, "invoice_access_key");
          if (current?.invoice_status !== "authorized" || !/^\d{44}$/u.test(key)) throw new BlingError("invoice_not_authorized", 409);
          await archiveBlingInvoice(db, provider, orderId, invoiceId, key);
        } else if (["pending", "processing"].includes(readString(current ?? {}, "invoice_status"))) {
          throw new BlingError("invoice_processing", 503, true, false, 120_000);
        }
      } else if (job.type === "bling.invoice.email") {
        throw new BlingError("email_kind_not_approved", 409);
      } else if (["bling.product.sync", "bling.product.create", "bling.product.reconcile", "bling.stock.sync"].includes(job.type)) {
        await executeBlingCatalogJob({ rpc: async (name, args) => db.rpc(name, args), provider, environment,
          type: job.type, variantId: readString(job.payload, "variantId") });
      } else if (job.type === "bling.webhook.reconcile") {
        await reconcileWebhook(db, provider, readString(job.payload, "eventId"));
      } else throw new BlingError("unsupported_job", 409);
      if (await call(db, "finish_bling_job", { p_job_id: job.id, p_lock_id: lockId,
        p_outcome: "completed", p_error_code: null }) !== true) throw new BlingError("job_lease_lost", 409);
      processed += 1;
    } catch (error) {
      failed += 1;
      const issue = error instanceof BlingError ? error : new BlingError("integration_failed", 503, true);
      if (issue.code === "validation_error") logServerEvent("error", "bling_job_validation_failed", {
        executionId, jobType: job.type, validationCodes: issue.validationCodes
      });
      if (issue.code === "job_lease_lost") break;
      const outcome = issue.retryable && !issue.uncertainWrite ? "retry" : "failed";
      if (job.type === "bling.order.create") {
        await db.rpc("mark_bling_order_issue", { p_order_id: readString(job.payload, "orderId"),
          p_status: issue.uncertainWrite ? "reconciliation_required" : outcome === "retry" ? "pending" : "failed",
          p_error_code: issue.code });
      } else if (job.type === "bling.invoice.generate" || job.type === "bling.invoice.send") {
        await db.rpc("mark_bling_invoice_issue", { p_order_id: readString(job.payload, "orderId"),
          p_status: issue.code === "fiscal_not_ready" || issue.code === "nature_required" || issue.code === "product_fiscal_data_required"
            ? "awaiting_data" : "error", p_error_code: issue.code });
      } else if (job.type === "bling.webhook.reconcile") {
        await db.rpc("finish_bling_webhook_event", { p_event_id: readString(job.payload, "eventId"),
          p_status: "failed", p_error_code: issue.code });
      }
      await call(db, "finish_bling_job", { p_job_id: job.id, p_lock_id: lockId,
        p_outcome: outcome, p_error_code: issue.code, p_retry_after_ms: Math.min(Math.max(Math.ceil(issue.retryAfterMs), 0), 86_400_000) });
    }
  }
  logServerEvent(failed ? "error" : "info", "bling_jobs_completed", { executionId, processed, failed });
  return { ok: failed === 0, processed, failed };
}
