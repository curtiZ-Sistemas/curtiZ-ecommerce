import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  allocateBlingFiscalCents, BlingError, buildBlingFiscalMirror, createBlingClient, expandBlingFiscalKit,
  readBlingAuthorizedResaleXml, selectBlingFiscalRule, type BlingClient
} from "@curtiz/integrations";
import { getMelhorEnvioEnvironment } from "@curtiz/config";
import { logServerEvent } from "@curtiz/security";
import { createMelhorEnvioProvider } from "./melhor-envio-server";
import { melhorEnvioStatusTransition } from "./melhor-envio-webhook";
import { kitCall, kitRecord } from "./representative-test-transactions";
import { type RuntimeEnvironment } from "./runtime-environment";
import { isUnknownRecord, readNumber, readRows, readString, type UnknownRecord } from "./unknown-data";

const row = (value: unknown) => isUnknownRecord(value) ? value : {};
const id = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const scopeError = () => new BlingError("kit_fiscal_clearance_failed", 409);

export async function verifyCommercialKitInvoice(db: SupabaseClient, provider: BlingClient, job: UnknownRecord, environment: 1 | 2) {
  const orderId = readString(job, "orderId");
  const saleId = readNumber(job, "saleId");
  const invoiceId = readNumber(job, "invoiceId");
  if (!Number.isSafeInteger(saleId) || saleId <= 0 || !Number.isSafeInteger(invoiceId) || invoiceId <= 0) throw scopeError();

  const sale = row(row(await provider.request(`/pedidos/vendas/${saleId}`)).data);
  const reference = `KITMG-${orderId}`;
  if (sale.id !== saleId || sale.numeroLoja !== reference || row(sale.notaFiscal).id !== invoiceId) throw scopeError();
  const invoice = row(row(await provider.request(`/nfe/${invoiceId}`)).data);
  const key = readString(invoice, "chaveAcesso");
  if (invoice.id !== invoiceId || invoice.situacao !== 5 || (invoice.numeroPedidoLoja && invoice.numeroPedidoLoja !== reference)
    || !/^31\d{42}$/u.test(key)) throw scopeError();

  const configuration = row(job.fiscalParameters);
  const issuer = readString(configuration, "issuerDocument");
  const buyerProfile = readString(job, "buyerProfile");
  const creditEligible = configuration.creditEligible;
  const issueDate = readString(invoice, "dataEmissao").slice(0, 10);
  if (!/^\d{14}$/u.test(issuer) || !["MG01", "MG02"].includes(buyerProfile) || typeof creditEligible !== "boolean"
    || (creditEligible && buyerProfile !== "MG01") || !/^\d{4}-\d{2}-\d{2}$/u.test(issueDate)
    || configuration.classification !== "third_party_no_st") throw scopeError();
  const rule = selectBlingFiscalRule([configuration.blingRule], {
    destinationState: "MG", icmsTaxpayer: true, finalConsumer: false, operation: "sale", creditEligible,
    recipientIsCompany: true, stateRegistrationActive: true, recipientTaxRegime: buyerProfile === "MG01" ? "normal" : "simples",
    goodsPurpose: "resale", saleDate: issueDate
  });
  if (rule.series !== 2 || !rule.external_nature_id || row(invoice.naturezaOperacao).id !== rule.external_nature_id) throw scopeError();

  const catalog = await kitRecord(db, "read_bling_catalog_variant", { p_variant_id: readString(job, "variantId") });
  const metadata = row(catalog.metadata);
  if (row(catalog.variant).sku !== job.sku || metadata.production_type !== "T" || metadata.fiscal_unit_approved !== true
    || readNumber(metadata, "pairs_per_sku") < 2) throw scopeError();
  const expanded = expandBlingFiscalKit({
    sku: readString(job, "sku"), description: readString(job, "productName"), quantity: readNumber(job, "quantity"),
    unit: readString(metadata, "commercial_unit"), pairsPerSku: readNumber(metadata, "pairs_per_sku"), fiscalUnitApproved: true,
    unitPriceInCents: readNumber(job, "unitPriceInCents"), ncm: readString(metadata, "ncm"),
    origin: readNumber(metadata, "origin"), cest: readString(metadata, "cest")
  }, catalog.kit_components);
  const freight = readNumber(job, "shippingInCents");
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

  const document = await provider.invoiceDocument(key, "xml");
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(document);
  const verified = readBlingAuthorizedResaleXml(xml, key, {
    environment, issueDate, invoiceNumber: id(invoice.numero), series: rule.series, issuerDocument: issuer,
    buyerDocument: readString(job, "buyerDocument"), buyerStateRegistration: readString(job, "buyerStateRegistration"),
    originPostalCode: readString(job, "originPostalCode"), destinationPostalCode: readString(job, "postalCode"),
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

export function commercialKitTracking(job: UnknownRecord, shipment: UnknownRecord, invoiceKey: string) {
  const orderId = readString(job, "orderId");
  const externalStatus = readString(shipment, "status");
  const status = melhorEnvioStatusTransition(readString(job, "shipmentStatus"), `order.${externalStatus}`, externalStatus);
  const from = row(shipment.from), to = row(shipment.to);
  if (readString(shipment, "id") !== job.shipmentId || id(row(shipment.service).id) !== job.serviceId
    || row(shipment.invoice).key !== invoiceKey || !readRows(shipment.tags).some(tag => tag.tag === `KITMG-${orderId}`)
    || readString(from, "postal_code").replace(/\D/gu, "") !== job.originPostalCode || from.state_abbr !== "MG"
    || readString(to, "postal_code").replace(/\D/gu, "") !== job.postalCode || to.state_abbr !== "MG") throw scopeError();
  const tracking = readString(shipment, "tracking");
  if (tracking && !/^[A-Za-z0-9-]{1,80}$/u.test(tracking)) throw scopeError();
  return status ? { ...status, tracking } : null;
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
  if (!jobs.length) return;
  const bling = createBlingClient(environment, async (name, args) => db.rpc(name, args), transport);
  for (const job of readRows(jobs)) {
    const orderId = readString(job, "orderId");
    let clearance = false;
    try {
      const verified = await verifyCommercialKitInvoice(db, bling, job, 1);
      clearance = await kitCall(db, "record_representative_kit_authorized_invoice", {
        p_order: orderId, p_sale: job.saleId, p_invoice: job.invoiceId,
        p_key: verified.key, p_protocol: verified.protocol, p_sha256: verified.hash
      }) === true;
      if (!clearance) throw scopeError();
      const shipmentId = readString(job, "shipmentId");
      if (!shipmentId) continue;
      if (getMelhorEnvioEnvironment(environment) !== "production") throw scopeError();
      const shipping = createMelhorEnvioProvider(environment, db, transport);
      const tracking = commercialKitTracking(job, await shipping.getShipment(shipmentId), verified.key);
      if (tracking && await kitCall(db, "record_representative_kit_tracking", {
        p_order: orderId, p_shipment: shipmentId, p_invoice_key: verified.key,
        p_status: tracking.status, p_tracking: tracking.tracking
      }) !== true) throw scopeError();
    } catch {
      logServerEvent("error", "representative_kit_fulfillment_check_failed", { orderId });
    } finally {
      await kitCall(db, "finish_representative_kit_fulfillment_check", { p_order: orderId, p_clearance_current: clearance });
    }
  }
}
