import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  BlingError, blingExternalSku, blingFiscalMirrorHash, commercialKitFiscalMirror, createBlingClient,
  verifyCommercialKitInvoice as verifySharedKitInvoice, type BlingClient
} from "@curtiz/integrations";
import { getMelhorEnvioEnvironment } from "@curtiz/config";
import { logServerEvent } from "@curtiz/security";
import { assertBlingExternalOrder, blingOrderPayload, findBlingContact, findBlingOrder } from "./bling-jobs";
import { assertBlingInvoicePaymentTerms, blingInvoicePaymentTerms, invoiceMatchesFiscalLines, prepareBlingFiscalDraft } from "./bling-invoice-draft";
import { createMelhorEnvioProvider } from "./melhor-envio-server";
import { commercialKitCollector, commercialKitPaymentProvider, kitPaymentMethodAllowed } from "./representative-commercial-payments";
import { advanceRepresentativeKitShipping } from "./representative-commercial-shipping";
import { verifyDueRepresentativeKitReturns } from "./representative-commercial-returns";
import { kitCall, kitRecord } from "./representative-test-transactions";
import { type RuntimeEnvironment } from "./runtime-environment";
import { isUnknownRecord, readNumber, readRows, readString, type UnknownRecord } from "./unknown-data";

const row = (value: unknown) => isUnknownRecord(value) ? value : {};
const id = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const scopeError = () => new BlingError("kit_fiscal_clearance_failed", 409);

const readVariant = (db: SupabaseClient) => (variantId: string) =>
  kitRecord(db, "read_bling_catalog_variant", { p_variant_id: variantId });

export async function verifyCommercialKitInvoice(db: SupabaseClient, provider: BlingClient, job: UnknownRecord, environment: 1 | 2,
  manual?: { key: string; invoice: UnknownRecord }, paymentMethod?: KitFiscalPayment) {
  const orderId = readString(job, "orderId");
  return verifySharedKitInvoice(provider, readVariant(db), job, environment, {
    reference: `KITMG-${orderId}`, ...(manual ? { manual } : {}), paymentMethod,
    billingPostalCode: async () => readString(row((await kitRecord(db, "read_representative_kit_bling_order", { p_order: orderId })).fiscalAddress), "postal_code")
  });
}

const positiveId = (value: unknown) => {
  const numeric = Number(id(value));
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
};

type KitFiscalPayment = "pix" | "cash" | "credit_card" | "debit_card";
const fiscalPaymentTypes: Record<KitFiscalPayment, readonly number[]> = {
  pix: [17, 20], cash: [1], credit_card: [3], debit_card: [4]
};

// The paid order is already gated by the database. Independently verify its actual
// provider payment before assigning a fiscal method: card charges must never become Pix.
async function resolveKitFiscalPayment(environment: RuntimeEnvironment, job: UnknownRecord, transport: typeof fetch): Promise<KitFiscalPayment> {
  const collection = readString(job, "collectionMethod");
  if (collection) {
    if (collection === "cash" || collection === "pix" || collection === "credit_card" || collection === "debit_card") return collection;
    throw new BlingError("invoice_fiscal_payment_method_invalid", 409);
  }
  const reference = `KITMG-${readString(job, "orderId")}`;
  const payment = await commercialKitPaymentProvider(environment, transport).findRepresentativeKitPayment(reference);
  if (!payment) throw new BlingError("kit_payment_unconfirmed", 409, true);
  if (payment.status !== "approved" || payment.externalReference !== reference
    || payment.collectorId !== commercialKitCollector(environment) || payment.currency !== "BRL"
    || payment.amountInCents !== readNumber(job, "amountInCents") || !payment.dateApproved
    || !Number.isFinite(Date.parse(payment.dateApproved)) || payment.refunds.length || !kitPaymentMethodAllowed(payment))
    throw new BlingError("kit_payment_unconfirmed", 409);
  if (payment.paymentMethodId === "pix") return "pix";
  if (payment.paymentTypeId === "credit_card" || payment.paymentTypeId === "debit_card") return payment.paymentTypeId;
  throw new BlingError("invoice_fiscal_payment_method_invalid", 409);
}

function kitBlingPaymentMethod(environment: RuntimeEnvironment, job: UnknownRecord, payment: KitFiscalPayment) {
  const collection = Boolean(readString(job, "collectionMethod"));
  if (collection && positiveId(job.collectionBlingMethod)) return positiveId(job.collectionBlingMethod);
  if (collection && payment !== "cash") return null;
  if (payment === "cash") return job.invoiceMode === "automatic" ? positiveId(environment.BLING_CASH_PAYMENT_METHOD_ID) : null;
  if (payment === "pix") return positiveId(environment.BLING_PAYMENT_METHOD_ID);
  return positiveId(payment === "credit_card" ? environment.BLING_REPRESENTATIVE_CREDIT_CARD_PAYMENT_METHOD_ID
    : environment.BLING_REPRESENTATIVE_DEBIT_CARD_PAYMENT_METHOD_ID);
}

async function advanceRepresentativeKitBling(db: SupabaseClient, provider: BlingClient, environment: RuntimeEnvironment, job: UnknownRecord, transport: typeof fetch) {
  const orderId = readString(job, "orderId");
  const reference = `KITMG-${orderId}`;
  const invoiceId = positiveId(job.invoiceId);
  if (invoiceId) {
    const invoice = row(row(await provider.request(`/nfe/${invoiceId}`)).data);
    if (Number(invoice.id) !== invoiceId) throw scopeError();
    if ([5, 6].includes(Number(invoice.situacao))) return true;
    if (Number(invoice.situacao) === 2) {
      await kitCall(db, "observe_representative_kit_invoice_cancellation", {
        p_order: orderId, p_invoice: invoiceId, p_key: readString(invoice, "chaveAcesso")
      });
      return false;
    }
    if ([4, 9, 11].includes(Number(invoice.situacao))) throw new BlingError("invoice_rejected_by_sefaz", 409);
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
  const { issuer, natureId, rule, commercial, mirror, freight } = await commercialKitFiscalMirror(readVariant(db), job, date);
  if (rule.series !== 3) throw scopeError();
  const buyerName = readString(context, "buyerName");
  const collection = Boolean(readString(job, "collectionMethod"));
  const paymentKind = await resolveKitFiscalPayment(environment, job, transport);
  const methodId = kitBlingPaymentMethod(environment, job, paymentKind);
  // Reasons the operator can act on; the panel translates these codes.
  if (!methodId) throw new BlingError("payment_method_required", 409);
  if (!/^\d{14}$/u.test(document)) throw new BlingError("buyer_cnpj_required", 409);
  if (!/^\d{2,14}$/u.test(registration)) throw new BlingError("buyer_registration_required", 409);
  if (address.state !== "MG" || billing.state !== "MG") throw scopeError();
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
  const method = row(row(await provider.request(`/formas-pagamentos/${methodId}`)).data);
  if (positiveId(method.id) !== methodId || Number(method.situacao) !== 1
    || ![2, 3].includes(Number(method.finalidade)) || !fiscalPaymentTypes[paymentKind].includes(Number(method.tipoPagamento)))
    throw new BlingError("invoice_fiscal_payment_method_invalid", 409);
  let approvedNature: UnknownRecord | undefined;
  for (let page = 1; page <= 20; page += 1) {
    const result = readRows(row(await provider.request(`/naturezas-operacoes?pagina=${page}&limite=100&situacao=1`)).data);
    approvedNature = result.find(nature => positiveId(nature.id) === natureId && Number(nature.situacao ?? 1) === 1);
    if (approvedNature || result.length < 100) break;
  }
  if (!approvedNature) throw new BlingError("nature_not_active", 409);
  if (id(approvedNature.serie) && Number(approvedNature.serie) !== rule.series) throw new BlingError("invoice_series_mismatch", 409);
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
    let contactId = await findBlingContact(provider, document);
    if (!contactId && job.invoiceMode === "automatic") {
      // The buyer's company is created in Bling from the approved order snapshot, once: the lookup
      // above runs again on every retry, so a retry never creates a second contact.
      contactId = positiveId(row(row(await provider.request("/contatos", { method: "POST", body: {
        nome: buyerName, situacao: "A", tipo: "J", numeroDocumento: document, ie: registration, contribuinte: 1,
        endereco: { geral: { endereco: readString(billing, "street"), numero: readString(billing, "number"),
          complemento: readString(billing, "complement"), bairro: readString(billing, "district"),
          municipio: readString(billing, "city"), uf: "MG", cep: readString(billing, "postal_code") } }
      } })).data).id);
      if (!contactId) throw new BlingError("uncertain_write", 503, false, true);
    }
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
  const before = row(row(await provider.request(`/nfe/${draft}`)).data);
  if (Number(before.id) !== draft || Number(before.tipo) !== 1 || Number(row(before.naturezaOperacao).id) !== natureId) throw scopeError();
  if (Number(before.serie) !== rule.series) throw new BlingError("invoice_series_mismatch", 409);
  if ([5, 6].includes(Number(before.situacao))) return false;
  if ([4, 9, 11].includes(Number(before.situacao))) throw new BlingError("invoice_rejected_by_sefaz", 409);
  if (Number(before.situacao) !== 1) return false;
  // Never edit a draft already carrying a fiscal key, even if Bling reports it as pending.
  if (readString(before, "chaveAcesso")) throw new BlingError("invoice_reconciliation_required", 409);
  const paymentTerms = blingInvoicePaymentTerms(sale, { totalInCents: mirror.totalInCents, paymentMethodId: methodId });
  await prepareBlingFiscalDraft(provider, draft, mirror.items, commercial.map(item => ({
    ...item, sku: blingExternalSku(item.sku,item.variantId)
  })), {
    document, icmsTaxpayer: true, businessRegistration: registration, natureId, recipientAddress: billing, paymentTerms,
    totalInCents: mirror.totalInCents, shippingInCents: freight, discountInCents: 0, additionalInCents: 0,
    freightMode: 3
  }, true, async () => await kitCall(db,"read_representative_kit_bling_order",{ p_order: orderId }) !== null);
  const preview = row(row(await provider.request(`/nfe/${draft}`)).data);
  if (Number(preview.serie) !== rule.series) throw new BlingError("invoice_series_mismatch", 409);
  if (!invoiceMatchesFiscalLines(preview, mirror.items)) throw new BlingError("invoice_items_mismatch", 409);
  assertBlingInvoicePaymentTerms(preview, paymentTerms);
  if (preview.valorNota == null || Math.round(Number(preview.valorNota) * 100) !== mirror.totalInCents
    || preview.valorFrete == null || Math.round(Number(preview.valorFrete) * 100) !== freight)
    throw new BlingError("invoice_draft_total_mismatch", 409);
  if (Number(preview.id) !== draft || Number(preview.situacao) !== 1 || Number(preview.tipo) !== 1
    || readString(preview, "chaveAcesso") || Number(row(preview.naturezaOperacao).id) !== natureId
    || Number(row(preview.transporte).fretePorConta) !== 3) throw scopeError();
  const draftHash = await blingFiscalMirrorHash({ orderId, draft, competence: date.slice(0,7), preview, mirror, origin: job.originPostalCode });
  if (await kitCall(db, "record_representative_kit_bling_draft", { p_order: orderId, p_invoice: draft, p_hash: draftHash }) !== true) throw scopeError();
  // MG02 automatic orders: the worker has just rebuilt the fiscal mirror (CFOP 5102, CSOSN 102, series 3,
  // nature) from the Bling preview, so it approves that exact hash instead of waiting for an operator.
  if (job.invoiceMode === "automatic"
    && await kitCall(db, "auto_approve_representative_kit_bling_draft", { p_order: orderId, p_hash: draftHash }) !== true) throw scopeError();
  if (environment.BLING_INVOICE_SEND_ENABLED !== "true" || environment.BLING_INVOICE_TRANSMISSION_MODE !== "production"
    || environment.BLING_LIVE_INVOICE_SEND_AUTHORIZED !== "true" || await claim("bling_invoice_send", draftHash) !== true) return false;
  await provider.request(`/nfe/${draft}/enviar?enviarEmail=false`, { method: "POST" });
  return false;
}

// Only a code is stored and shown, never provider text or personal data. Retryable provider failures
// and uncertain writes stay in the queue (the database makes the third attempt final).
export function automaticFailureReason(error: unknown): { code: string; final: boolean } {
  if (error instanceof BlingError) {
    return { code: /^[a-z0-9_]{3,80}$/u.test(error.code) ? error.code : "bling_error", final: !error.retryable && !error.uncertainWrite };
  }
  return { code: "unexpected_error", final: false };
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
      // The database decides the mode per order: manual only when configured or after the automatic issue failed.
      const manualMode = job.invoiceMode === undefined
        ? row(job.fiscalParameters).advancePixWithManualInvoice === true : job.invoiceMode === "manual";
      if (manualMode) {
        if (job.autoInvoiceFailed !== true && environment.REPRESENTATIVE_KIT_MANUAL_FISCAL_ENABLED !== "true") continue;
        const manual = row(await kitCall(db, "read_representative_kit_manual_invoice", { p_order: orderId }));
        if (manual.manual !== true) throw scopeError();
        const invoiceId = positiveId(manual.invoiceId);
        const key = readString(manual, "key");
        if (!invoiceId || !key) continue;
        const invoice = row(row(await bling.request(`/nfe/${invoiceId}`)).data);
        if (Number(invoice.id) === invoiceId && invoice.chaveAcesso === key && Number(invoice.situacao) === 2) {
          await kitCall(db, "observe_representative_kit_invoice_cancellation", { p_order: orderId, p_invoice: invoiceId, p_key: key });
          continue;
        }
        const verified = await verifyCommercialKitInvoice(db, bling, { ...job, invoiceId }, 1, { key, invoice });
        clearance = await kitCall(db, "confirm_representative_kit_manual_invoice", {
          p_order: orderId, p_invoice: invoiceId, p_key: verified.key,
          p_protocol: verified.protocol, p_sha256: verified.hash
        }) === true;
        if (!clearance) throw scopeError();
        if (job.ownDelivery !== true && !readString(job, "collectionMethod")) {
          if (getMelhorEnvioEnvironment(environment) !== "production") throw scopeError();
          const shipping = createMelhorEnvioProvider(environment, db, transport);
          await advanceRepresentativeKitShipping(db, shipping, environment, job, verified.key);
        }
        continue;
      }
      if (!await advanceRepresentativeKitBling(db, bling, environment, job, transport)) continue;
      const verified = await verifyCommercialKitInvoice(db, bling, job, 1, undefined, await resolveKitFiscalPayment(environment, job, transport));
      clearance = await kitCall(db, "record_representative_kit_authorized_invoice", {
        p_order: orderId, p_sale: job.saleId, p_invoice: job.invoiceId,
        p_key: verified.key, p_protocol: verified.protocol, p_sha256: verified.hash
      }) === true;
      if (!clearance) throw scopeError();
      if (job.ownDelivery === true || readString(job, "collectionMethod")) continue;
      if (getMelhorEnvioEnvironment(environment) !== "production") throw scopeError();
      const shipping = createMelhorEnvioProvider(environment, db, transport);
      await advanceRepresentativeKitShipping(db, shipping, environment, job, verified.key);
    } catch (error) {
      const reason = automaticFailureReason(error);
      logServerEvent("error", "representative_kit_fulfillment_check_failed", { orderId, reason: reason.code });
      if (job.invoiceMode === "automatic" && !clearance) {
        try {
          await kitCall(db, "record_representative_kit_auto_invoice_error", {
            p_order: orderId, p_reason: reason.code, p_final: reason.final
          });
        } catch { /* The queue retries the check; the failure itself was logged. */ }
      }
    } finally {
      await kitCall(db, "finish_representative_kit_fulfillment_check", { p_order: orderId, p_clearance_current: clearance });
    }
  }
  await verifyDueRepresentativeKitReturns(db, bling);
}
