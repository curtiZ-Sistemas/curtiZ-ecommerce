import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertBlingExternalOrder, BlingError, blingExternalSku, blingFiscalMirrorHash, blingInvoicePaymentTerms, blingOrderPayload,
  commercialKitFiscalMirror, findBlingContact, findBlingOrder, prepareBlingFiscalDraft, verifyCommercialKitInvoice,
  invoiceMatchesFiscalLines, type BlingClient
} from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";

type Environment = Readonly<Record<string, string | undefined>>;
type UnknownRecord = Record<string, unknown>;

export type WholesaleStep = "contact" | "sale" | "draft" | "send" | "authorization";
/** waiting = the invoice is saved and safe, but something outside the app has to happen (see `code`). */
export type WholesaleIssueResult = { status: "authorized" | "waiting" | "error" | "busy"; code?: string };

const row = (value: unknown): UnknownRecord => value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const rows = (value: unknown): UnknownRecord[] => Array.isArray(value) ? value.map(row) : [];
const scalar = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const digits = (value: unknown) => text(value).replace(/\D/gu, "");
const positiveId = (value: unknown) => {
  const numeric = Number(typeof value === "string" || typeof value === "number" ? value : NaN);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
};
const scopeError = () => new BlingError("kit_fiscal_clearance_failed", 409);
const saoPauloDate = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo",
  year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const SEND_BLOCKED_SITUATIONS = [2, 4, 9, 11];
const WAITING_SITUATIONS = [3, 8, 10];

/** Fixed, non-personal reason stored with a failed or waiting invoice. */
export function wholesaleFailureCode(error: unknown): string {
  if (error instanceof BlingError) return /^[a-z0-9_]{3,80}$/u.test(error.code) ? error.code : "bling_error";
  return "unexpected_error";
}

async function call(db: SupabaseClient, name: string, args: UnknownRecord): Promise<unknown> {
  const result = await db.rpc(name, args);
  if (result.error) {
    logServerEvent("error", "wholesale_invoice_storage_failed", { rpc: name, databaseCode: /^[0-9A-Z]{5}$/u.test(result.error.code) ? result.error.code : "unknown" });
    throw new BlingError("storage_unavailable", 503, true);
  }
  return result.data;
}

/**
 * Issues (or resumes) the NF-e of one wholesale invoice. Idempotent: every irreversible write to Bling is
 * claimed in the database first, and each step looks at Bling before writing, so a retry after any failure
 * never creates a second sale or invoice. Respects the same BLING_* flags as the representatives' worker.
 */
export async function issueWholesaleKitInvoice(input: {
  db: SupabaseClient; provider: BlingClient; environment: Environment; invoiceId: string;
  onStep?: (step: WholesaleStep) => void; sleep?: (milliseconds: number) => Promise<void>;
}): Promise<WholesaleIssueResult> {
  const { db, provider, environment } = input;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const step = (name: WholesaleStep) => input.onStep?.(name);
  const job = row(await call(db, "begin_wholesale_kit_invoice_issue", { p_id: input.invoiceId }));
  if (text(job.wholesaleId) !== input.invoiceId) return { status: "busy" };

  const progress = async (status: "draft" | "error", code: string) => {
    await call(db, "record_wholesale_kit_invoice_progress", { p_id: input.invoiceId, p_status: status, p_code: code });
  };
  const waiting = async (code: string): Promise<WholesaleIssueResult> => { await progress("draft", code); return { status: "waiting", code }; };
  const readVariant = async (variantId: string) => row(await call(db, "read_bling_catalog_variant", { p_variant_id: variantId }));
  const claim = async (operation: string, hash: string | null = null) =>
    await call(db, "claim_wholesale_kit_invoice_write", { p_id: input.invoiceId, p_operation: operation, p_expected_hash: hash }) === true;
  const readInvoice = async (invoiceId: number) => row(row(await provider.request(`/nfe/${invoiceId}`)).data);

  try {
    if (environment.APP_ENV !== "production") return await waiting("bling_not_production");
    if (job.fiscalCurrent !== true) throw new BlingError("wholesale_grade_changed", 409);
    const reference = `ATACADO-${input.invoiceId}`;
    const billing = row(job.fiscalAddress);
    const document = text(job.buyerDocument);
    const registration = text(job.buyerStateRegistration);
    let saleId = positiveId(job.saleId);
    let draftId = positiveId(job.invoiceId);

    const authorize = async (invoiceId: number, invoice: UnknownRecord): Promise<WholesaleIssueResult> => {
      const verified = await verifyCommercialKitInvoice(provider, readVariant, { ...job, saleId, invoiceId }, 1, {
        reference, billingPostalCode: async () => text(billing.postal_code)
      });
      const authorized = await call(db, "record_wholesale_kit_invoice_authorized", {
        p_id: input.invoiceId, p_sale: saleId, p_invoice: invoiceId, p_key: verified.key, p_protocol: verified.protocol,
        p_sha256: verified.hash, p_number: scalar(invoice.numero)
      });
      if (authorized !== true) throw scopeError();
      return { status: "authorized" };
    };
    const awaitAuthorization = async (invoiceId: number): Promise<WholesaleIssueResult> => {
      step("authorization");
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const invoice = await readInvoice(invoiceId);
        const situation = Number(invoice.situacao);
        if (Number(invoice.id) !== invoiceId) throw scopeError();
        if (situation === 5) return authorize(invoiceId, invoice);
        if (SEND_BLOCKED_SITUATIONS.includes(situation)) throw new BlingError(situation === 2 ? "invoice_cancelled_in_bling" : "invoice_rejected_by_sefaz", 409);
        if (attempt < 5) await sleep(4000);
      }
      return waiting("awaiting_authorization");
    };

    if (draftId) {
      const invoice = await readInvoice(draftId);
      if (Number(invoice.id) !== draftId) throw scopeError();
      const situation = Number(invoice.situacao);
      if (situation === 5) return await authorize(draftId, invoice);
      if (SEND_BLOCKED_SITUATIONS.includes(situation)) throw new BlingError(situation === 2 ? "invoice_cancelled_in_bling" : "invoice_rejected_by_sefaz", 409);
      if (WAITING_SITUATIONS.includes(situation)) return await awaitAuthorization(draftId);
      if (situation !== 1) throw scopeError();
    }
    if (environment.BLING_ORDER_SYNC_ENABLED !== "true") return await waiting("bling_order_sync_disabled");

    const today = saoPauloDate();
    const { issuer, natureId, rule, commercial, mirror } = await commercialKitFiscalMirror(readVariant, job, today);
    if (rule.series !== 3) throw scopeError();
    const methodId = positiveId(job.paymentMethod === "cash" ? environment.BLING_CASH_PAYMENT_METHOD_ID : environment.BLING_PAYMENT_METHOD_ID);
    if (!methodId) throw new BlingError("payment_method_required", 409);
    if (!/^\d{14}$/u.test(document) || (registration && !/^\d{2,14}$/u.test(registration))) throw scopeError();
    if (text(billing.state) !== "MG" || !/^3\d{7}$/u.test(text(billing.postal_code))) throw new BlingError("buyer_outside_mg", 409);

    const company = row(row(await provider.request("/empresas/me/dados-basicos")).data);
    const account = row(await call(db, "read_bling_account", { p_environment: "production" }));
    const companyId = typeof company.id === "number" || typeof company.id === "string" ? String(company.id) : "";
    if (!companyId || companyId !== scalar(account.companyId) || digits(company.cnpj) !== issuer) throw scopeError();

    const order = { public_code: reference, payment_status: "pending", status: "awaiting_receipt", placed_at: job.createdAt,
      customer_name_snapshot: text(job.buyerName), shipping_address_snapshot: billing, subtotal: mirror.totalInCents / 100,
      discount_total: 0, shipping_total: 0, fee_total: 0, grand_total: mirror.totalInCents / 100 };
    const items = commercial.map(item => ({
      variant_id: item.variantId, sku_snapshot: item.sku, product_name_snapshot: item.description,
      quantity: item.quantity, unit_price: item.unitPriceInCents / 100,
      total: (item.unitPriceInCents * item.quantity) / 100, discount_amount: 0
    }));

    saleId ??= await findBlingOrder(provider, reference);
    if (!saleId) {
      step("contact");
      let contactId = await findBlingContact(provider, document);
      if (!contactId) {
        // The company is created in Bling from the reviewed snapshot only when it is not there yet.
        contactId = positiveId(row(row(await provider.request("/contatos", { method: "POST", body: {
          nome: text(job.buyerName), situacao: "A", tipo: "J", numeroDocumento: document,
          ...(registration ? { ie: registration } : {}), contribuinte: registration ? 1 : 9,
          endereco: { geral: { endereco: text(billing.street), numero: text(billing.number), complemento: text(billing.complement),
            bairro: text(billing.district), municipio: text(billing.city), uf: "MG", cep: text(billing.postal_code) } }
        } })).data).id);
        if (!contactId) throw new BlingError("uncertain_write", 503, false, true);
      }
      const contact = row(row(await provider.request(`/contatos/${contactId}`)).data);
      const contactAddress = row(row(contact.endereco).geral);
      if (Number(contact.id) !== contactId || contact.tipo !== "J" || text(contactAddress.uf) !== "MG"
        || digits(contactAddress.cep) !== text(billing.postal_code) || digits(contact.numeroDocumento) !== document
        || digits(contact.ie) !== registration) throw scopeError();
      step("sale");
      const links = await call(db, "read_bling_product_links", { p_variant_ids: [...new Set(commercial.map(item => item.variantId))] });
      const payload = blingOrderPayload({ order, items, productLinks: rows(links), contactId, paymentMethodId: methodId, natureId,
        collectionDueDate: today });
      if (!await claim("bling_sale")) throw new BlingError("uncertain_write", 503, false, true);
      saleId = positiveId(row(row(await provider.request("/pedidos/vendas", { method: "POST", body: payload })).data).id);
      if (!saleId) throw new BlingError("uncertain_write", 503, false, true);
    }
    if (await call(db, "record_wholesale_kit_invoice_sale", { p_id: input.invoiceId, p_sale: saleId }) !== true) throw scopeError();

    const sale = row(row(await provider.request(`/pedidos/vendas/${saleId}`)).data);
    assertBlingExternalOrder(order, items, sale);
    const saleContactId = positiveId(row(sale.contato).id);
    if (Number(sale.id) !== saleId || !saleContactId) throw scopeError();
    const saleContact = row(row(await provider.request(`/contatos/${saleContactId}`)).data);
    if (digits(saleContact.numeroDocumento) !== document || digits(saleContact.ie) !== registration) throw scopeError();

    if (environment.BLING_INVOICE_SYNC_ENABLED !== "true" || environment.BLING_INVOICE_STOCK_AUTOMATION_DISABLED !== "true")
      return await waiting("bling_invoice_sync_disabled");

    step("draft");
    draftId ??= positiveId(row(sale.notaFiscal).id);
    if (!draftId) {
      if (!rows(sale.itens).length || rows(sale.itens).some(line => Number(row(line.naturezaOperacao).id) !== natureId)) throw scopeError();
      if (!await claim("bling_invoice_draft")) throw new BlingError("uncertain_write", 503, false, true);
      draftId = positiveId(row(await provider.request(`/pedidos/vendas/${saleId}/gerar-nfe`, { method: "POST" })).idNotaFiscal);
      if (!draftId) throw new BlingError("uncertain_write", 503, false, true);
    }
    const paymentTerms = blingInvoicePaymentTerms(sale, { totalInCents: mirror.totalInCents, paymentMethodId: methodId });
    await prepareBlingFiscalDraft(provider, draftId, mirror.items, commercial.map(item => ({
      ...item, sku: blingExternalSku(item.sku, item.variantId)
    })), {
      document, icmsTaxpayer: registration !== "", businessRegistration: registration, natureId, recipientAddress: billing, paymentTerms,
      totalInCents: mirror.totalInCents, shippingInCents: 0, discountInCents: 0, additionalInCents: 0, freightMode: 3
    }, true, async () => text(row(await call(db, "read_wholesale_kit_invoice_job", { p_id: input.invoiceId })).status) === "issuing");
    const preview = row(row(await provider.request(`/nfe/${draftId}`)).data);
    if (Number(preview.id) !== draftId || Number(preview.situacao) !== 1 || Number(preview.serie) !== rule.series
      || Number(row(preview.naturezaOperacao).id) !== natureId || !invoiceMatchesFiscalLines(preview, mirror.items)
      || Number(row(preview.transporte).fretePorConta) !== 3) throw scopeError();
    const hash = await blingFiscalMirrorHash({ orderId: input.invoiceId, draft: draftId, competence: today.slice(0, 7), preview, mirror, origin: job.originPostalCode });
    if (await call(db, "record_wholesale_kit_invoice_draft", { p_id: input.invoiceId, p_sale: saleId, p_invoice: draftId, p_hash: hash }) !== true)
      throw scopeError();

    if (environment.BLING_INVOICE_SEND_ENABLED !== "true" || environment.BLING_INVOICE_TRANSMISSION_MODE !== "production"
      || environment.BLING_LIVE_INVOICE_SEND_AUTHORIZED !== "true") return await waiting("bling_send_disabled");
    step("send");
    if (await claim("bling_invoice_send", hash)) {
      await provider.request(`/nfe/${draftId}/enviar?enviarEmail=false`, { method: "POST" });
    }
    return await awaitAuthorization(draftId);
  } catch (error) {
    const code = wholesaleFailureCode(error);
    logServerEvent("error", "wholesale_invoice_issue_failed", { invoiceId: input.invoiceId, reason: code });
    try { await progress("error", code); } catch { /* The invoice stays "issuing" and is released for retry after a few minutes. */ }
    return { status: "error", code };
  }
}
