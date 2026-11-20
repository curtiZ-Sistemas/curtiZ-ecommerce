import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  allocateBlingFiscalCents, BlingError, blingExternalSku, blingFiscalMirrorHash, buildBlingFiscalMirror,
  createBlingClient, expandBlingFiscalKit, readBlingAuthorizedResaleXml, selectBlingFiscalRule, type BlingClient, type BlingFiscalItem
} from "@curtiz/integrations";
import { getMelhorEnvioEnvironment } from "@curtiz/config";
import { logServerEvent } from "@curtiz/security";
import { assertBlingExternalOrder, blingOrderPayload, findBlingContact, findBlingOrder } from "./bling-jobs";
import { blingInvoicePaymentTerms, invoiceMatchesFiscalLines, prepareBlingFiscalDraft } from "./bling-invoice-draft";
import { createMelhorEnvioProvider } from "./melhor-envio-server";
import { advanceRepresentativeKitShipping } from "./representative-commercial-shipping";
import { priceRepresentativeGradeItems } from "./representative-grade-lines";
import { verifyDueRepresentativeKitReturns } from "./representative-commercial-returns";
import { kitCall, kitRecord } from "./representative-test-transactions";
import { type RuntimeEnvironment } from "./runtime-environment";
import { isUnknownRecord, readNumber, readRows, readString, type UnknownRecord } from "./unknown-data";

const row = (value: unknown) => isUnknownRecord(value) ? value : {};
const id = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const scopeError = () => new BlingError("kit_fiscal_clearance_failed", 409);

type KitSaleLine = BlingFiscalItem & { variantId: string };

async function commercialKitFiscalLines(db: SupabaseClient, job: UnknownRecord): Promise<{
  commercial: KitSaleLine[];
  expanded: BlingFiscalItem[];
}> {
  const unitPriceInCents = readNumber(job, "unitPriceInCents");
  const quantity = readNumber(job, "quantity");
  if (Array.isArray(job.gradeLines)) {
    const priced = priceRepresentativeGradeItems(job.gradeLines, unitPriceInCents, quantity);
    const metadataByVariant = new Map<string, UnknownRecord>();
    const commercial: KitSaleLine[] = [];
    for (const item of priced) {
      let metadata = metadataByVariant.get(item.variantId);
      if (!metadata) {
        const catalog = await kitRecord(db, "read_bling_catalog_variant", { p_variant_id: item.variantId });
        metadata = row(catalog.metadata);
        if (row(catalog.variant).sku !== item.sku || metadata.production_type !== "T"
          || metadata.fiscal_unit_approved !== true || readNumber(metadata, "pairs_per_sku") !== 1
          || readString(metadata, "commercial_unit") !== "PR") throw scopeError();
        metadataByVariant.set(item.variantId, metadata);
      }
      commercial.push({
        sku: item.sku, variantId: item.variantId, description: `${item.name} · Tamanho ${item.size}`,
        quantity: item.quantity, unit: "PR", pairsPerSku: 1, fiscalUnitApproved: true,
        unitPriceInCents: item.unitPriceInCents, ncm: readString(metadata, "ncm"),
        origin: readNumber(metadata, "origin"), cest: readString(metadata, "cest")
      });
    }
    return { commercial, expanded: commercial.map(item => ({ ...item, sku: blingExternalSku(item.sku, item.variantId) })) };
  }

  const variantId = readString(job, "variantId");
  const catalog = await kitRecord(db, "read_bling_catalog_variant", { p_variant_id: variantId });
  const metadata = row(catalog.metadata);
  if (row(catalog.variant).sku !== job.sku || metadata.production_type !== "T" || metadata.fiscal_unit_approved !== true
    || readNumber(metadata, "pairs_per_sku") < 2) throw scopeError();
  const commercial = {
    sku: readString(job, "sku"), description: readString(job, "productName"), quantity, variantId,
    unit: readString(metadata, "commercial_unit"), pairsPerSku: readNumber(metadata, "pairs_per_sku"), fiscalUnitApproved: true,
    unitPriceInCents, ncm: readString(metadata, "ncm"), origin: readNumber(metadata, "origin"), cest: readString(metadata, "cest")
  };
  return { commercial: [commercial], expanded: expandBlingFiscalKit(commercial, catalog.kit_components) };
}

async function commercialKitFiscalMirror(db: SupabaseClient, job: UnknownRecord, issueDate: string) {
  const configuration = row(job.fiscalParameters);
  const issuer = readString(configuration, "issuerDocument");
  const buyerProfile = readString(job, "buyerProfile");
  const creditEligible = configuration.creditEligible;
  if (!/^\d{14}$/u.test(issuer) || !["MG01", "MG02"].includes(buyerProfile) || typeof creditEligible !== "boolean"
    || (creditEligible && buyerProfile !== "MG01") || !/^\d{4}-\d{2}-\d{2}$/u.test(issueDate)
    || configuration.classification !== "third_party_no_st") throw scopeError();
  const rule = selectBlingFiscalRule([configuration.blingRule], {
    destinationState: "MG", icmsTaxpayer: true, finalConsumer: false, operation: "sale", creditEligible,
    recipientIsCompany: true, stateRegistrationActive: true, recipientTaxRegime: buyerProfile === "MG01" ? "normal" : "simples",
    goodsPurpose: "resale", saleDate: issueDate
  });
  if ((rule.series !== 2 && rule.series !== 3) || !rule.external_nature_id) throw scopeError();

  const { commercial, expanded } = await commercialKitFiscalLines(db, job);
  const freight = readNumber(job, "shippingInCents");
  if (rule.series === 3 && freight !== 0) throw scopeError();
  const amounts = expanded.map(item => item.quantity * item.unitPriceInCents);
  const allocations = freight === 0 ? amounts.map(() => 0) : allocateBlingFiscalCents(freight, amounts);
  const base = configuration.creditBase;
  if (creditEligible && base !== "merchandise" && base !== "merchandise_with_shipping") throw scopeError();
  const mirror = buildBlingFiscalMirror(rule, expanded, {
    shippingInCents: freight,
    ...(creditEligible ? { icmsCreditBasesInCents: amounts.map((amount, index) => amount + (base === "merchandise_with_shipping" ? allocations[index]! : 0)) } : {})
  });
  if (!mirror.taxConfiguration || !mirror.items.every(item => item.ncm === "64022000" && item.origin === 0 && item.unit === "PR")
    || (creditEligible && !mirror.icmsCredit) || mirror.totalInCents !== readNumber(job, "amountInCents")) throw scopeError();
  return { issuer, natureId: rule.external_nature_id, rule, commercial, mirror, allocations, freight };
}

export async function verifyCommercialKitInvoice(db: SupabaseClient, provider: BlingClient, job: UnknownRecord, environment: 1 | 2) {
  const orderId = readString(job, "orderId");
  const saleId = readNumber(job, "saleId");
  const invoiceId = readNumber(job, "invoiceId");
  if (!Number.isSafeInteger(saleId) || saleId <= 0 || !Number.isSafeInteger(invoiceId) || invoiceId <= 0) throw scopeError();
  const sale = row(row(await provider.request(`/pedidos/vendas/${saleId}`)).data);
  const reference = `KITMG-${orderId}`;
  if (Number(sale.id) !== saleId || sale.numeroLoja !== reference || Number(row(sale.notaFiscal).id) !== invoiceId) throw scopeError();
  const invoice = row(row(await provider.request(`/nfe/${invoiceId}`)).data);
  const key = readString(invoice, "chaveAcesso");
  if (Number(invoice.id) !== invoiceId || Number(invoice.situacao) !== 5
    || (invoice.numeroPedidoLoja && invoice.numeroPedidoLoja !== reference) || !/^31\d{42}$/u.test(key)) throw scopeError();
  const issueDate = readString(invoice, "dataEmissao").slice(0, 10);
  const { issuer, natureId, rule, mirror, allocations, freight } = await commercialKitFiscalMirror(db, job, issueDate);
  const context = await kitRecord(db,"read_representative_kit_bling_order",{ p_order: orderId });
  const billing = row(context.fiscalAddress);
  if (Number(row(invoice.naturezaOperacao).id) !== natureId) throw scopeError();
  const document = await provider.invoiceDocument(key, "xml");
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(document);
  const verified = readBlingAuthorizedResaleXml(xml, key, {
    environment, issueDate, invoiceNumber: id(invoice.numero), series: rule.series, issuerDocument: issuer,
    buyerDocument: readString(job, "buyerDocument"), buyerStateRegistration: readString(job, "buyerStateRegistration"),
    originPostalCode: readString(job, "originPostalCode"), destinationPostalCode: readString(billing, "postal_code"),
    deliveryPostalCode: readString(job, "postalCode"),
    totalInCents: mirror.totalInCents, shippingInCents: freight, additionalInfo: mirror.icmsCredit?.message,
    items: mirror.items.map((item, index) => {
      const credit = mirror.icmsCredit;
      const icms: Record<string, string> = credit ? {
        pCredSN: credit.rate.toFixed(4), vCredICMSSN: (credit.itemsInCents[index]! / 100).toFixed(2)
      } : {};
      return { ...item, cfop: rule.cfop, csosn: rule.csosn, shippingInCents: allocations[index]!, icms };
    })
  });
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", document)),
    byte => byte.toString(16).padStart(2, "0")).join("");
  return { key, protocol: verified.protocol, hash };
}

const positiveId = (value: unknown) => {
  const numeric = Number(id(value));
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
};

async function advanceRepresentativeKitBling(db: SupabaseClient, provider: BlingClient, environment: RuntimeEnvironment, job: UnknownRecord) {
  const orderId = readString(job, "orderId");
  const reference = `KITMG-${orderId}`;
  const invoiceId = positiveId(job.invoiceId);
  if (invoiceId) {
    const invoice = row(row(await provider.request(`/nfe/${invoiceId}`)).data);
    if (Number(invoice.id) !== invoiceId) throw scopeError();
    if (Number(invoice.situacao) === 5) return true;
    if (Number(invoice.situacao) === 2) {
      await kitCall(db, "observe_representative_kit_invoice_cancellation", {
        p_order: orderId, p_invoice: invoiceId, p_key: readString(invoice, "chaveAcesso")
      });
      return false;
    }
    if (Number(invoice.situacao) !== 1) return false;
  }
  if (environment.BLING_ORDER_SYNC_ENABLED !== "true") return false;
  const context = await kitRecord(db, "read_representative_kit_bling_order", { p_order: orderId });
  const document = readString(context, "buyerDocument");
  const registration = readString(context, "buyerRegistration");
  const address = row(context.address);
  const billing = row(context.fiscalAddress);
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { issuer, natureId, rule, commercial, mirror, freight } = await commercialKitFiscalMirror(db, job, date);
  if (rule.series !== 3) throw scopeError();
  const buyerName = readString(context, "buyerName");
  const collection = Boolean(readString(job, "collectionMethod"));
  const methodId = positiveId(collection ? job.collectionBlingMethod : environment.BLING_PAYMENT_METHOD_ID);
  if (!methodId || !/^\d{14}$/u.test(document) || !/^\d{2,14}$/u.test(registration) || address.state !== "MG" || billing.state !== "MG") throw scopeError();
  let collectionDueDate: string | undefined;
  const scheduledCashDate = readString(job, "collectionDueOn");
  if (scheduledCashDate) {
    if (job.collectionMethod !== "cash" || !/^\d{4}-\d{2}-\d{2}$/u.test(scheduledCashDate)) throw scopeError();
    collectionDueDate = scheduledCashDate;
  } else if (collection) {
    const days = readNumber(job, "deliveryDays", -1);
    const submitted = Date.parse(readString(job, "createdAt"));
    if (!Number.isInteger(days) || days < 0 || days > 60 || !Number.isFinite(submitted)) throw scopeError();
    collectionDueDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(submitted + days * 86_400_000));
  }

  const company = row(row(await provider.request("/empresas/me/dados-basicos")).data);
  const account = await kitRecord(db, "read_bling_account", { p_environment: "production" });
  if (id(company.id) !== id(account.companyId) || !id(company.id)
    || readString(company, "cnpj").replace(/\D/gu, "") !== issuer) throw scopeError();
  const order = { public_code: reference, payment_status: collection ? "pending" : "approved",
    status: collection ? "awaiting_receipt" : "payment_approved", placed_at: collection ? job.createdAt : job.paidAt,
    customer_name_snapshot: buyerName, shipping_address_snapshot: address, subtotal: (mirror.totalInCents - freight) / 100,
    discount_total: 0, shipping_total: freight / 100, fee_total: 0, grand_total: mirror.totalInCents / 100 };
  const items = commercial.map(item => ({
    variant_id: item.variantId, sku_snapshot: item.sku, product_name_snapshot: item.description,
    quantity: item.quantity, unit_price: item.unitPriceInCents / 100,
    total: (item.unitPriceInCents * item.quantity) / 100, discount_amount: 0
  }));
  const claim = (operation: string, hash: string | null = null) => {
    const args = { p_order: orderId, p_operation: operation, p_expected_hash: hash };
    return scheduledCashDate
      ? kitCall(db, "claim_representative_kit_bling_write_for_delivery", { ...args, p_collection_due_on: scheduledCashDate })
      : kitCall(db, "claim_representative_kit_bling_write", args);
  };
  const linkedSale = positiveId(context.saleId);
  let saleId = linkedSale ?? await findBlingOrder(provider, reference);
  if (!saleId) {
    const contactId = await findBlingContact(provider, document);
    if (!contactId) throw scopeError();
    const contact = row(row(await provider.request(`/contatos/${contactId}`)).data);
    const fiscalAddress = row(row(contact.endereco).geral);
    if (Number(contact.id) !== contactId || contact.tipo !== "J" || fiscalAddress.uf !== "MG"
      || readString(fiscalAddress, "cep").replace(/\D/gu, "") !== billing.postal_code
      || readString(contact, "numeroDocumento").replace(/\D/gu, "") !== document
      || readString(contact, "ie").replace(/\D/gu, "") !== registration) throw scopeError();
    const links = await kitCall(db, "read_bling_product_links", { p_variant_ids: [...new Set(commercial.map(item => item.variantId))] });
    const payload = blingOrderPayload({ order, items, productLinks: readRows(links), contactId, paymentMethodId: methodId, natureId,
      ...(collectionDueDate ? { collectionDueDate } : {}) });
    if (await claim("bling_sale") !== true) return false;
    saleId = positiveId(row(row(await provider.request("/pedidos/vendas", { method: "POST", body: payload })).data).id);
    if (!saleId) throw new BlingError("uncertain_write", 503, false, true);
  }
  const sale = row(row(await provider.request(`/pedidos/vendas/${saleId}`)).data);
  assertBlingExternalOrder(order, items, sale);
  const saleContactId = positiveId(row(sale.contato).id);
  if (Number(sale.id) !== saleId || !saleContactId) throw scopeError();
  const saleContact = row(row(await provider.request(`/contatos/${saleContactId}`)).data);
  if (readString(saleContact, "numeroDocumento").replace(/\D/gu, "") !== document
    || readString(saleContact, "ie").replace(/\D/gu, "") !== registration) throw scopeError();
  const link = (invoice: number | null) => kitCall(db, "link_representative_kit_bling_sale", {
    p_order: orderId, p_sale: saleId, p_invoice: invoice
  });
  const existingDraft = positiveId(row(sale.notaFiscal).id);
  if (await link(existingDraft) !== true) throw scopeError();
  if (environment.BLING_INVOICE_SYNC_ENABLED !== "true" || environment.BLING_INVOICE_STOCK_AUTOMATION_DISABLED !== "true") return false;
  let draft = existingDraft;
  if (!draft) {
    if (!readRows(sale.itens).length || readRows(sale.itens).some(line => Number(row(line.naturezaOperacao).id) !== natureId)) throw scopeError();
    if (await claim("bling_invoice_draft") !== true) return false;
    draft = positiveId(row(await provider.request(`/pedidos/vendas/${saleId}/gerar-nfe`, { method: "POST" })).idNotaFiscal);
    if (!draft || await link(draft) !== true) throw new BlingError("uncertain_write", 503, false, true);
  }
  const paymentTerms = blingInvoicePaymentTerms(sale, { totalInCents: mirror.totalInCents, paymentMethodId: methodId });
  await prepareBlingFiscalDraft(provider, draft, mirror.items, commercial.map(item => ({
    ...item, sku: blingExternalSku(item.sku,item.variantId)
  })), {
    document, icmsTaxpayer: true, businessRegistration: registration, natureId, recipientAddress: billing, paymentTerms,
    totalInCents: mirror.totalInCents, shippingInCents: freight, discountInCents: 0, additionalInCents: 0,
    freightMode: 3
  }, true, async () => await kitCall(db,"read_representative_kit_bling_order",{ p_order: orderId }) !== null);
  const preview = row(row(await provider.request(`/nfe/${draft}`)).data);
  if (Number(preview.id) !== draft || Number(preview.situacao) !== 1 || Number(preview.serie) !== rule.series
    || Number(row(preview.naturezaOperacao).id) !== natureId || !invoiceMatchesFiscalLines(preview, mirror.items)
    || Number(row(preview.transporte).fretePorConta) !== 3) throw scopeError();
  const draftHash = await blingFiscalMirrorHash({ orderId, draft, competence: date.slice(0,7), preview, mirror, origin: job.originPostalCode });
  if (await kitCall(db, "record_representative_kit_bling_draft", { p_order: orderId, p_invoice: draft, p_hash: draftHash }) !== true) throw scopeError();
  if (environment.BLING_INVOICE_SEND_ENABLED !== "true" || environment.BLING_INVOICE_TRANSMISSION_MODE !== "production"
    || environment.BLING_LIVE_INVOICE_SEND_AUTHORIZED !== "true" || await claim("bling_invoice_send", draftHash) !== true) return false;
  await provider.request(`/nfe/${draft}/enviar?enviarEmail=false`, { method: "POST" });
  return false;
}

export async function runRepresentativeCommercialFulfillment(environment: RuntimeEnvironment, transport: typeof fetch = fetch) {
  if (environment.APP_ENV !== "production" || environment.REPRESENTATIVE_KIT_FULFILLMENT_ENABLED !== "true"
    || environment.BLING_FISCAL_READY !== "true") return;
  const secret = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!secret || !environment.SUPABASE_URL) return;
  const url = new URL(environment.SUPABASE_URL);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return;
  const db = createClient(url.origin, secret, { global: { fetch: transport }, auth: { autoRefreshToken: false, persistSession: false } });
  const jobs = await kitCall(db, "due_representative_kit_fulfillment", {});
  if (!Array.isArray(jobs)) throw scopeError();
  const bling = createBlingClient(environment, async (name, args) => db.rpc(name, args), transport);
  for (const job of readRows(jobs)) {
    const orderId = readString(job, "orderId");
    let clearance = false;
    try {
      if (!await advanceRepresentativeKitBling(db, bling, environment, job)) continue;
      const verified = await verifyCommercialKitInvoice(db, bling, job, 1);
      clearance = await kitCall(db, "record_representative_kit_authorized_invoice", {
        p_order: orderId, p_sale: job.saleId, p_invoice: job.invoiceId,
        p_key: verified.key, p_protocol: verified.protocol, p_sha256: verified.hash
      }) === true;
      if (!clearance) throw scopeError();
      if (job.ownDelivery === true || readString(job, "collectionMethod")) continue;
      if (getMelhorEnvioEnvironment(environment) !== "production") throw scopeError();
      const shipping = createMelhorEnvioProvider(environment, db, transport);
      await advanceRepresentativeKitShipping(db, shipping, environment, job, verified.key);
    } catch {
      logServerEvent("error", "representative_kit_fulfillment_check_failed", { orderId });
    } finally {
      await kitCall(db, "finish_representative_kit_fulfillment_check", { p_order: orderId, p_clearance_current: clearance });
    }
  }
  await verifyDueRepresentativeKitReturns(db, bling);
}
