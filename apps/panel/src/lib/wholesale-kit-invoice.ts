import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertBlingExternalOrder, assertBlingInvoicePaymentTerms, BlingError, blingExternalSku, blingFiscalMirrorHash, blingInvoicePaymentTerms, blingOrderPayload,
  commercialKitFiscalMirror, findBlingContact, findBlingOrder, prepareBlingFiscalDraft, verifyCommercialKitInvoice,
  invoiceMatchesFiscalLines, type BlingClient
} from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";

type Environment = Readonly<Record<string, string | undefined>>;
type UnknownRecord = Record<string, unknown>;

export type WholesaleStep = "contact" | "sale" | "draft" | "send" | "authorization";
/** waiting = the invoice is saved and safe, but something outside the app has to happen (see `code`). */
export type WholesaleDraftReview = {
  hash: string; number: string; series: string; date: string; operationDate: string;
  issuer: string; nature: string; buyer: string; document: string; registration: string; address: string;
  totalInCents: number; freight: string; payment: string; cfop: string; csosn: string;
  items: { code: string; description: string; unit: string; quantity: string; unitValue: string; ncm: string; origin: string; cfop: string; csosn: string }[];
};
export type WholesaleIssueResult = { status: "authorized" | "ready" | "waiting" | "error" | "busy"; code?: string; review?: WholesaleDraftReview };

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

// GET /nfe returns summary objects, not the complete invoice. The order
// reference is a detail field; verify it before adopting or deleting a note.
async function findWholesaleDraft(provider: BlingClient, reference: string): Promise<UnknownRecord | null> {
  const result = row(await provider.request(`/nfe?numeroLoja=${encodeURIComponent(reference)}&pagina=1&limite=100`));
  if (!Array.isArray(result.data) || result.data.length >= 100) throw new BlingError("draft_lookup_unconfirmed", 409);
  const matches: UnknownRecord[] = [];
  for (const entry of result.data) {
    const id = positiveId(row(entry).id);
    if (!id) throw new BlingError("draft_lookup_unconfirmed", 409);
    const detail = row(row(await provider.request(`/nfe/${id}`)).data);
    if (positiveId(detail.id) !== id || text(detail.numeroPedidoLoja || detail.numeroLoja) !== reference)
      throw new BlingError("draft_lookup_unconfirmed", 409);
    matches.push(detail);
  }
  if (matches.length > 1) throw new BlingError("duplicate_external_invoice", 409);
  return matches[0] ?? null;
}

function logWholesaleProviderError(event: string, invoiceId: string, stage: string, error: unknown) {
  logServerEvent("error", event, { invoiceId, stage, reason: wholesaleFailureCode(error),
    ...(error instanceof BlingError ? { providerStatus: error.status, validationCodes: error.validationCodes,
      validationFields: error.validationFields, validationTopics: error.validationHints } : {}) });
}

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
  onStep?: (step: WholesaleStep) => void; sleep?: (milliseconds: number) => Promise<void>; reviewedOperationDate?: string; reviewedHash?: string;
}): Promise<WholesaleIssueResult> {
  const { db, provider, environment } = input;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const step = (name: WholesaleStep) => input.onStep?.(name);
  const job = row(await call(db, "begin_wholesale_kit_invoice_issue", { p_id: input.invoiceId }));
  if (text(job.wholesaleId) !== input.invoiceId) return { status: "busy" };

  const progress = async (status: "draft" | "error", code: string) => {
    if (await call(db, "record_wholesale_kit_invoice_progress", { p_id: input.invoiceId, p_status: status, p_code: code }) !== true) throw scopeError();
  };
  const waiting = async (code: string): Promise<WholesaleIssueResult> => { await progress("draft", code); return { status: "waiting", code }; };
  const readVariant = async (variantId: string) => row(await call(db, "read_bling_catalog_variant", { p_variant_id: variantId }));
  const claim = async (operation: string, hash: string | null = null) =>
    await call(db, "claim_wholesale_kit_invoice_write", { p_id: input.invoiceId, p_operation: operation, p_expected_hash: hash }) === true;
  const readInvoice = async (invoiceId: number) => row(row(await provider.request(`/nfe/${invoiceId}`)).data);
  let stage = "initial";

  try {
    if (environment.APP_ENV !== "production") return await waiting("bling_not_production");
    stage = "fiscal_scope";
    const reference = `ATACADO-${input.invoiceId}`;
    const billing = row(job.fiscalAddress);
    const document = text(job.buyerDocument);
    const registration = text(job.buyerStateRegistration);
    const paymentMethod = job.paymentMethod;
    if (paymentMethod !== "pix" && paymentMethod !== "cash") throw new BlingError("payment_method_required", 409);
    let saleId = positiveId(job.saleId);
    let draftId = positiveId(job.invoiceId);

    const authorize = async (invoiceId: number, invoice: UnknownRecord): Promise<WholesaleIssueResult> => {
      const verified = await verifyCommercialKitInvoice(provider, readVariant, { ...job, saleId, invoiceId }, 1, {
        reference, billingPostalCode: async () => text(billing.postal_code), paymentMethod
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
        if (situation === 5 || situation === 6) return authorize(invoiceId, invoice);
        if (SEND_BLOCKED_SITUATIONS.includes(situation)) throw new BlingError(situation === 2 ? "invoice_cancelled_in_bling" : "invoice_rejected_by_sefaz", 409);
        if (attempt < 5) await sleep(4000);
      }
      return waiting("awaiting_authorization");
    };

    if (draftId) {
      const invoice = await readInvoice(draftId);
      if (Number(invoice.id) !== draftId) throw scopeError();
      const situation = Number(invoice.situacao);
      if (situation === 5 || situation === 6) return await authorize(draftId, invoice);
      if (SEND_BLOCKED_SITUATIONS.includes(situation)) throw new BlingError(situation === 2 ? "invoice_cancelled_in_bling" : "invoice_rejected_by_sefaz", 409);
      if (WAITING_SITUATIONS.includes(situation) || job.sendClaimed === true) return await awaitAuthorization(draftId);
      if (situation !== 1) throw scopeError();
    }
    if (job.fiscalCurrent !== true) throw new BlingError("wholesale_grade_changed", 409);
    if (await call(db, "wholesale_kit_invoice_rule_current", { p_id: input.invoiceId }) !== true) throw new BlingError("wholesale_rule_changed", 409);
    // A send action cannot create a fresh sale or draft. It must refer to the
    // exact persisted review, or the operator must return to preparation.
    if (input.reviewedHash && (!draftId || !saleId || text(job.draftHash) !== input.reviewedHash))
      return await waiting("draft_review_required");
    if (environment.BLING_ORDER_SYNC_ENABLED !== "true") return await waiting("bling_order_sync_disabled");

    const today = saoPauloDate();
    const { issuer, natureId, rule, commercial, mirror } = await commercialKitFiscalMirror(readVariant, job, today);
    if (rule.series !== 3) throw scopeError();
    const methodId = positiveId(paymentMethod === "cash" ? environment.BLING_CASH_PAYMENT_METHOD_ID : environment.BLING_PAYMENT_METHOD_ID);
    if (!methodId) throw new BlingError("payment_method_required", 409);
    if (!/^\d{14}$/u.test(document) || (registration && !/^\d{2,14}$/u.test(registration))) throw scopeError();
    if (text(billing.state) !== "MG" || !/^3\d{7}$/u.test(text(billing.postal_code))) throw new BlingError("buyer_outside_mg", 409);

    const company = row(row(await provider.request("/empresas/me/dados-basicos")).data);
    const account = row(await call(db, "read_bling_account", { p_environment: "production" }));
    const companyId = typeof company.id === "number" || typeof company.id === "string" ? String(company.id) : "";
    if (!companyId || companyId !== scalar(account.companyId) || digits(company.cnpj) !== issuer) throw scopeError();
    stage = "fiscal_payment_method";
    const method = row(row(await provider.request(`/formas-pagamentos/${methodId}`)).data);
    const fiscalTypes = paymentMethod === "cash" ? [1] : [17, 20];
    if (positiveId(method.id) !== methodId || Number(method.situacao) !== 1
      || ![2, 3].includes(Number(method.finalidade)) || !fiscalTypes.includes(Number(method.tipoPagamento)))
      throw new BlingError("invoice_fiscal_payment_method_invalid", 409);
    stage = "fiscal_scope";
    // The approved nature must be active before creating a provider sale.
    // Bling's list API does not expose the configured series; check the actual
    // draft's series as soon as it is available, before any PUT.
    let approvedNature: UnknownRecord | undefined;
    for (let page = 1; page <= 20; page += 1) {
      const result = rows(row(await provider.request(`/naturezas-operacoes?pagina=${page}&limite=100&situacao=1`)).data);
      approvedNature = result.find(nature => positiveId(nature.id) === natureId && Number(nature.situacao ?? 1) === 1);
      if (approvedNature) break;
      if (result.length < 100) break;
    }
    if (!approvedNature) throw new BlingError("nature_not_active", 409);
    // The list normally omits the series. If it is exposed, detect a known
    // configuration mismatch before creating another sale.
    const configuredSeries = scalar(approvedNature.serie);
    if (configuredSeries && Number(configuredSeries) !== rule.series) {
      logServerEvent("warn", "wholesale_invoice_nature_series_mismatch", {
        invoiceId: input.invoiceId, natureId, expectedSeries: rule.series, observedSeries: positiveId(configuredSeries)
      });
      throw new BlingError("invoice_series_mismatch", 409);
    }
    const assertSeries = (invoice: UnknownRecord) => {
      if (Number(invoice.serie) === rule.series) return;
      logServerEvent("warn", "wholesale_invoice_draft_series_mismatch", {
        invoiceId: input.invoiceId, natureId, expectedSeries: rule.series,
        observedSeries: positiveId(invoice.serie), observedNatureId: positiveId(row(invoice.naturezaOperacao).id)
      });
      throw new BlingError("invoice_series_mismatch", 409);
    };

    const order = { public_code: reference, payment_status: "pending", status: "awaiting_receipt", placed_at: job.createdAt,
      customer_name_snapshot: text(job.buyerName), shipping_address_snapshot: billing, subtotal: mirror.totalInCents / 100,
      discount_total: 0, shipping_total: 0, fee_total: 0, grand_total: mirror.totalInCents / 100 };
    const items = commercial.map(item => ({
      variant_id: item.variantId, sku_snapshot: item.sku, product_name_snapshot: item.description,
      quantity: item.quantity, unit_price: item.unitPriceInCents / 100,
      total: (item.unitPriceInCents * item.quantity) / 100, discount_amount: 0
    }));

    stage = "sale_lookup";
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
      let saleError: unknown;
      if (await claim("bling_sale")) {
        try { saleId = positiveId(row(row(await provider.request("/pedidos/vendas", { method: "POST", body: payload })).data).id); }
        catch (error) { saleError = error; }
      }
      if (!saleId) {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          saleId = await findBlingOrder(provider, reference);
          if (saleId) break;
          if (attempt < 3) await sleep(1500);
        }
      }
      if (!saleId) {
        if (saleError instanceof BlingError && !saleError.uncertainWrite) throw saleError;
        return await waiting("awaiting_bling_confirmation");
      }
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
    stage = "draft_generation";
    draftId ??= positiveId(row(sale.notaFiscal).id);
    let independentlyLinked = false;
    // A previous POST may have created an invoice without updating the sale link.
    if (!draftId && job.draftClaimed === true) {
      const existing = await findWholesaleDraft(provider, reference);
      if (existing) { draftId = positiveId(existing.id); independentlyLinked = true; }
      else {
        // A definitive refusal is different from a timeout. Confirm the
        // exact sale still has no invoice, then let the database check the
        // prior refusal and age of the claim under its row lock.
        const refreshed = row(row(await provider.request(`/pedidos/vendas/${saleId}`)).data);
        assertBlingExternalOrder(order, items, refreshed);
        if (Number(refreshed.id) !== saleId) throw scopeError();
        draftId = positiveId(row(refreshed.notaFiscal).id);
        if (!draftId && await call(db, "reopen_rejected_wholesale_draft", { p_id: input.invoiceId, p_sale: saleId }) !== true)
          return await waiting("awaiting_bling_confirmation");
      }
    }
    if (!draftId) {
      if (!rows(sale.itens).length || rows(sale.itens).some(line => Number(row(line.naturezaOperacao).id) !== natureId)) throw scopeError();
      // The POST may have succeeded even when the response was lost or wrapped differently.
      // A claimed write with an unknown outcome must never be repeated.
      let generationError: unknown;
      if (await claim("bling_invoice_draft")) {
        try {
          const generated = row(await provider.request(`/pedidos/vendas/${saleId}/gerar-nfe`, { method: "POST" }));
          draftId = positiveId(generated.idNotaFiscal) ?? positiveId(row(generated.data).idNotaFiscal);
        } catch (error) { generationError = error; logWholesaleProviderError("wholesale_draft_generation_failed", input.invoiceId, stage, error); }
      }
      if (!draftId) {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const refreshed = row(row(await provider.request(`/pedidos/vendas/${saleId}`)).data);
          if (Number(refreshed.id) !== saleId) throw scopeError();
          assertBlingExternalOrder(order, items, refreshed);
          draftId = positiveId(row(refreshed.notaFiscal).id);
          if (draftId) break;
          if (attempt < 3) await sleep(1500);
        }
      }
      if (!draftId) {
        const existing = await findWholesaleDraft(provider, reference);
        if (existing) { draftId = positiveId(existing.id); independentlyLinked = true; }
      }
      if (!draftId) {
        if (generationError instanceof BlingError && !generationError.uncertainWrite) {
          if (generationError.code === "validation_error") throw new BlingError("draft_generation_rejected", generationError.status);
          throw generationError;
        }
        return await waiting("awaiting_bling_confirmation");
      }
    }
    // Confirm the exact link before adopting a draft, including a lost POST response.
    let linked = positiveId(row(sale.notaFiscal).id);
    for (let attempt = 0; !independentlyLinked && linked !== draftId && attempt < 4; attempt += 1) {
      if (linked) throw scopeError();
      const refreshed = row(row(await provider.request(`/pedidos/vendas/${saleId}`)).data);
      assertBlingExternalOrder(order, items, refreshed);
      if (Number(refreshed.id) !== saleId) throw scopeError();
      linked = positiveId(row(refreshed.notaFiscal).id);
      if (linked !== draftId && attempt < 3) await sleep(1500);
    }
    if (linked && linked !== draftId) throw scopeError();
    const recovered = await readInvoice(draftId);
    if (Number(recovered.id) !== draftId) throw scopeError();
    if (linked !== draftId) {
      if (text(recovered.numeroPedidoLoja || recovered.numeroLoja) !== reference
        || digits(row(recovered.contato).numeroDocumento) !== document
        || Math.round(Number(recovered.valorNota) * 100) !== mirror.totalInCents
        || Number(recovered.tipo) !== 1 || Number(row(recovered.naturezaOperacao).id) !== natureId)
        return await waiting("awaiting_bling_confirmation");
    }
    stage = "draft_preparation";
    if (await call(db, "link_wholesale_kit_invoice_draft", { p_id: input.invoiceId, p_sale: saleId, p_invoice: draftId }) !== true) throw scopeError();
    const recoveredSituation = Number(recovered.situacao);
    if (recoveredSituation === 5 || recoveredSituation === 6) return await authorize(draftId, recovered);
    if (SEND_BLOCKED_SITUATIONS.includes(recoveredSituation)) throw new BlingError("invoice_rejected_by_sefaz", 409);
    if (WAITING_SITUATIONS.includes(recoveredSituation)) return await awaitAuthorization(draftId);
    if (recoveredSituation !== 1) return await waiting("awaiting_bling_confirmation");
    assertSeries(recovered);
    const paymentTerms = blingInvoicePaymentTerms(sale, { totalInCents: mirror.totalInCents, paymentMethodId: methodId });
    if (!input.reviewedHash) await prepareBlingFiscalDraft(provider, draftId, mirror.items, commercial.map(item => ({
      ...item, sku: blingExternalSku(item.sku, item.variantId)
    })), {
      document, icmsTaxpayer: registration !== "", businessRegistration: registration, natureId, recipientAddress: billing, paymentTerms,
      totalInCents: mirror.totalInCents, shippingInCents: 0, discountInCents: 0, additionalInCents: 0, freightMode: 3,
      reviewedOperationDate: input.reviewedOperationDate
    }, true, async () => text(row(await call(db, "read_wholesale_kit_invoice_job", { p_id: input.invoiceId })).status) === "issuing");
    const preview = row(row(await provider.request(`/nfe/${draftId}`)).data);
    if (!invoiceMatchesFiscalLines(preview, mirror.items)) throw new BlingError("invoice_items_mismatch", 409);
    assertBlingInvoicePaymentTerms(preview, paymentTerms);
    if (Math.round(Number(preview.valorNota) * 100) !== mirror.totalInCents || preview.valorFrete == null || Number(preview.valorFrete) !== 0)
      throw new BlingError("invoice_draft_total_mismatch", 409);
    assertSeries(preview);
    if (Number(preview.id) !== draftId || Number(preview.situacao) !== 1 || Number(preview.tipo) !== 1
      || Number(row(preview.naturezaOperacao).id) !== natureId
      || Number(row(preview.transporte).fretePorConta) !== 3) throw scopeError();
    const hash = await blingFiscalMirrorHash({ orderId: input.invoiceId, draft: draftId, competence: today.slice(0, 7), preview, mirror, origin: job.originPostalCode });
    if (input.reviewedHash && hash !== input.reviewedHash) return await waiting("draft_review_changed");
    if (!input.reviewedHash) {
      if (await call(db, "record_wholesale_kit_invoice_draft", { p_id: input.invoiceId, p_sale: saleId, p_invoice: draftId, p_hash: hash }) !== true)
        throw scopeError();
      const recipient = row(preview.contato);
      const address = row(recipient.endereco);
      const review: WholesaleDraftReview = {
        hash, number: scalar(preview.numero), series: scalar(preview.serie), date: scalar(preview.dataEmissao),
        operationDate: scalar(preview.dataOperacao), issuer, nature: scalar(row(preview.naturezaOperacao).descricao) || String(natureId),
        buyer: scalar(recipient.nome) || text(job.buyerName), document: scalar(recipient.numeroDocumento) || document,
        registration: scalar(recipient.ie) || registration,
        address: [address.endereco, address.numero, address.complemento, address.bairro, address.municipio, address.uf, address.cep].map(scalar).filter(Boolean).join(", "),
        totalInCents: mirror.totalInCents, freight: "Transporte próprio", payment: job.paymentMethod === "cash" ? "Dinheiro" : "Pix",
        cfop: scalar(rule.cfop), csosn: scalar(rule.csosn),
        items: rows(preview.itens).map(item => ({ code: scalar(item.codigo), description: scalar(item.descricao), unit: scalar(item.unidade),
          quantity: scalar(item.quantidade), unitValue: scalar(item.valor), ncm: scalar(item.classificacaoFiscal), origin: scalar(item.origem),
          cfop: scalar(item.cfop), csosn: scalar(row(row(item.tributacao).icms).csosn) }))
      };
      await progress("draft", "draft_ready");
      return { status: "ready", review };
    }

    if (environment.BLING_INVOICE_SEND_ENABLED !== "true" || environment.BLING_INVOICE_TRANSMISSION_MODE !== "production"
      || environment.BLING_LIVE_INVOICE_SEND_AUTHORIZED !== "true") return await waiting("bling_send_disabled");
    stage = "sefaz_send";
    step("send");
    if (await claim("bling_invoice_send", hash)) {
      await provider.request(`/nfe/${draftId}/enviar?enviarEmail=false`, { method: "POST" });
    }
    return await awaitAuthorization(draftId);
  } catch (error) {
    const code = wholesaleFailureCode(error);
    logWholesaleProviderError("wholesale_invoice_issue_failed", input.invoiceId, stage, error);
    try { await progress("error", code); } catch { /* The invoice stays "issuing" and is released for retry after a few minutes. */ }
    return { status: "error", code };
  }
}

/** Inspect the persisted remote note without taking an issuance lease or mutating anything. */
export async function inspectWholesaleDraft(input: {
  db: SupabaseClient; provider: BlingClient; invoiceId: string; expectedDraftId: number;
}): Promise<WholesaleDraftReview> {
  const { db, provider, invoiceId, expectedDraftId } = input;
  const job = row(await call(db, "read_wholesale_kit_invoice_job", { p_id: invoiceId }));
  const saleId = positiveId(job.saleId);
  const document = text(job.buyerDocument);
  const issuer = text(row(job.fiscalParameters).issuerDocument);
  if (text(job.wholesaleId) !== invoiceId || positiveId(job.invoiceId) !== expectedDraftId || !saleId
    || !/^\d{14}$/u.test(document) || !/^\d{14}$/u.test(issuer)) throw scopeError();
  const company = row(row(await provider.request("/empresas/me/dados-basicos")).data);
  const account = row(await call(db, "read_bling_account", { p_environment: "production" }));
  if (!scalar(company.id) || scalar(company.id) !== scalar(account.companyId) || digits(company.cnpj) !== issuer) throw scopeError();
  const sale = row(row(await provider.request(`/pedidos/vendas/${saleId}`)).data);
  const reference = `ATACADO-${invoiceId}`;
  if (positiveId(sale.id) !== saleId || text(sale.numeroLoja) !== reference
    || positiveId(row(sale.notaFiscal).id) && positiveId(row(sale.notaFiscal).id) !== expectedDraftId) throw scopeError();
  const preview = row(row(await provider.request(`/nfe/${expectedDraftId}`)).data);
  const recipient = row(preview.contato);
  const draftReference = text(preview.numeroPedidoLoja || preview.numeroLoja);
  if (positiveId(preview.id) !== expectedDraftId || digits(recipient.numeroDocumento) !== document
    || Number(preview.tipo) !== 1 || (draftReference && draftReference !== reference)
    || (positiveId(row(sale.notaFiscal).id) !== expectedDraftId && draftReference !== reference)) throw scopeError();
  return reviewFromProvider(job, preview, issuer);
}

function reviewFromProvider(job: UnknownRecord, preview: UnknownRecord, issuer: string): WholesaleDraftReview {
  const recipient = row(preview.contato);
  const address = row(recipient.endereco);
  const rule = row(row(job.fiscalParameters).blingRule);
  const totalInCents = Math.round(Number(preview.valorNota) * 100);
  if (!Number.isSafeInteger(totalInCents) || totalInCents < 0 || !Array.isArray(preview.itens)) throw scopeError();
  const freight = Number(row(preview.transporte).fretePorConta);
  return {
    // No usable authorization hash: only the normal review/issue path can produce it.
    hash: "", number: scalar(preview.numero), series: scalar(preview.serie), date: scalar(preview.dataEmissao),
    operationDate: scalar(preview.dataOperacao), issuer, nature: scalar(row(preview.naturezaOperacao).descricao) || scalar(row(preview.naturezaOperacao).id),
    buyer: scalar(recipient.nome), document: scalar(recipient.numeroDocumento), registration: scalar(recipient.ie),
    address: [address.endereco, address.numero, address.complemento, address.bairro, address.municipio, address.uf, address.cep].map(scalar).filter(Boolean).join(", "),
    totalInCents, freight: freight === 3 ? "Transporte próprio" : Number.isFinite(freight) ? `Modalidade ${freight}` : "Não informado",
    payment: "Não conciliado nesta consulta", cfop: scalar(rule.cfop), csosn: scalar(rule.csosn),
    items: rows(preview.itens).map(item => ({ code: scalar(item.codigo), description: scalar(item.descricao), unit: scalar(item.unidade),
      quantity: scalar(item.quantidade), unitValue: scalar(item.valor), ncm: scalar(item.classificacaoFiscal), origin: scalar(item.origem),
      cfop: scalar(item.cfop), csosn: scalar(row(row(item.tributacao).icms).csosn) }))
  };
}

/** A locally reconstructed history is not a copy of the provider document. */
export function reviewFromCancelledHistory(history: UnknownRecord): WholesaleDraftReview {
  const job = row(history.job), buyer = row(history.buyer), address = row(buyer.address);
  const rule = row(row(job.fiscalParameters).blingRule);
  const selections = rows(history.selections);
  const items = selections.map(item => ({
    code: scalar(item.kitId), description: scalar(item.kitName || job.productName) || "Kit de atacado",
    unit: "ficha", quantity: scalar(item.quantity), unitValue: String(Number(item.unitPriceInCents) / 100),
    ncm: "", origin: "", cfop: "", csosn: ""
  }));
  return { hash: "", number: "", series: scalar(rule.series), date: scalar(job.createdAt), operationDate: "",
    issuer: scalar(row(job.fiscalParameters).issuerDocument), nature: "Regra fiscal registrada na venda",
    buyer: scalar(buyer.name), document: scalar(buyer.document), registration: scalar(buyer.registration),
    address: [address.street,address.number,address.complement,address.district,address.city,address.state,address.postal_code].map(scalar).filter(Boolean).join(", "),
    totalInCents: Number(job.amountInCents), freight: "Entrega própria (prevista)", payment: history.paymentMethod === "cash" ? "Dinheiro" : "Pix",
    cfop: scalar(rule.cfop), csosn: scalar(rule.csosn), items };
}

export type WholesaleCancelBlock = "draft_refused" | "sale_refused" | "draft_still_present" | "draft_not_pending"
  | "pending" | "access_key_requires_reconciliation";

/** Reconcile an explicit panel cancellation; never delete a transmitted NF-e or release stock on uncertainty. */
export async function cancelWholesaleKitInvoice(input: {
  db: SupabaseClient; provider: BlingClient; environment: Environment; invoiceId: string; job: UnknownRecord;
  afterBlingReview?: boolean;
  onBlocked?: (reason: WholesaleCancelBlock) => void;
}): Promise<boolean> {
  const { db, provider, environment, invoiceId, job } = input;
  const p_id = invoiceId;
  let stage = "cancel_scope";
  const finish = async () => await call(db, "finish_wholesale_kit_invoice_cancel", { p_id }) === true;
  const get = async (path: string): Promise<UnknownRecord | null> => {
    try {
      const data = row(row(await provider.request(path)).data);
      if (!positiveId(data.id)) throw scopeError();
      return data;
    } catch (error) {
      if (error instanceof BlingError && error.status === 404) return null;
      throw error;
    }
  };
  const remove = async (path: string, verifyPath: string) => {
    let refusal: BlingError | undefined;
    try { await provider.request(path, { method: "DELETE" }); }
    catch (error) {
      if (!(error instanceof BlingError)) throw error;
      refusal = error;
    }
    // A definitive refusal may race with an operator or a previous deletion.
    // Never release stock unless a fresh GET confirms the resource is absent.
    if (await get(verifyPath)) {
      if (refusal) throw refusal;
      throw new BlingError("cancel_reconciliation_pending", 409);
    }
  };
  try {
    if (text(job.wholesaleId) !== invoiceId || job.sendClaimed === true) throw scopeError();
    let saleId = positiveId(job.saleId);
    let draftId = positiveId(job.invoiceId);
    if (!saleId && !draftId && job.saleClaimed !== true && job.draftClaimed !== true) return await finish();
    if (environment.APP_ENV !== "production" || environment.BLING_INVOICE_STOCK_AUTOMATION_DISABLED !== "true") throw scopeError();
    const reference = `ATACADO-${invoiceId}`;
    const company = row(row(await provider.request("/empresas/me/dados-basicos")).data);
    const account = row(await call(db, "read_bling_account", { p_environment: "production" }));
    if (!scalar(company.id) || scalar(company.id) !== scalar(account.companyId)
      || digits(company.cnpj) !== text(row(job.fiscalParameters).issuerDocument)) throw scopeError();
    saleId ??= await findBlingOrder(provider, reference);
    if (!saleId) throw new BlingError("cancel_reconciliation_pending", 409);
    stage = "cancel_sale_read";
    const salePath = `/pedidos/vendas/${saleId}`;
    const sale = await get(salePath);
    if (sale) {
      if (Number(sale.id) !== saleId || text(sale.numeroLoja) !== reference
        || Math.round(Number(sale.total) * 100) !== Number(job.amountInCents)) throw scopeError();
      const contactId = positiveId(row(sale.contato).id);
      if (!contactId) throw scopeError();
      const contact = await get(`/contatos/${contactId}`);
      if (!contact || digits(contact.numeroDocumento) !== text(job.buyerDocument)) throw scopeError();
      const linked = positiveId(row(sale.notaFiscal).id);
      if (draftId && linked && draftId !== linked) throw scopeError();
      draftId ??= linked;
    }
    // A lost draft response must be reconciled by its unique order reference, not guessed.
    if (!draftId && job.draftClaimed === true) {
      stage = "cancel_draft_lookup";
      const match = await findWholesaleDraft(provider, reference);
      if (match) {
        draftId = positiveId(match.id);
        if (!draftId) throw scopeError();
      } else if (!Number.isFinite(Date.parse(text(job.draftClaimedAt))) || Date.now() - Date.parse(text(job.draftClaimedAt)) < 180_000) {
        throw new BlingError("cancel_reconciliation_pending", 409);
      }
    }
    stage = "cancel_record_remote";
    if (await call(db, "record_wholesale_cancel_remote", { p_id, p_sale: saleId, p_invoice: draftId }) !== true) throw scopeError();
    if (draftId) {
      stage = "cancel_draft_read";
      const path = `/nfe/${draftId}`;
      const draft = await get(path);
      if (draft) {
        const linked = positiveId(row(sale?.notaFiscal).id) === draftId;
        const draftReference = text(draft.numeroPedidoLoja || draft.numeroLoja);
        const persistedLink = positiveId(job.invoiceId) === draftId;
        const expectedNature = rows(row(row(job.fiscalParameters).blingRule).natures).find(nature => nature.final_consumer === false);
        const exactPersisted = persistedLink && !draftReference && Number(draft.tipo) === 1
          && Math.round(Number(draft.valorNota) * 100) === Number(job.amountInCents)
          && positiveId(row(draft.naturezaOperacao).id) === positiveId(expectedNature?.external_nature_id)
          && positiveId(expectedNature?.external_nature_id) !== null;
        if (Number(draft.id) !== draftId
          || (draftReference && draftReference !== reference)
          || (!linked && draftReference !== reference && !exactPersisted)
          || digits(row(draft.contato).numeroDocumento) !== text(job.buyerDocument)) throw scopeError();
        if (Number(draft.situacao) !== 1) throw new BlingError("cancel_draft_not_pending", 409);
        stage = "cancel_draft_snapshot";
        const preview = reviewFromProvider(job, draft, digits(company.cnpj));
        if (await call(db, "save_wholesale_cancel_preview", { p_id, p_preview: preview }) !== true) throw scopeError();
        // A key can be generated before authorization; it still requires fiscal reconciliation.
        if (text(draft.chaveAcesso).trim()) throw new BlingError("cancel_access_key_requires_reconciliation", 409);
        if (input.afterBlingReview) throw new BlingError("cancel_draft_still_present", 409);
        stage = "cancel_draft_delete";
        await remove(`/nfe?idsNotas%5B%5D=${draftId}`, path);
      }
    }
    if (sale) {
      stage = "cancel_sale_delete";
      const current = await get(salePath);
      if (current) {
        if (text(current.numeroLoja) !== reference || Number(current.id) !== saleId
          || (positiveId(row(current.notaFiscal).id) && positiveId(row(current.notaFiscal).id) !== draftId)) throw scopeError();
        // Bling refuses deletion when its own stock/financial movements prevent safe removal.
        // Do not blindly reverse settled financial entries or create a second refund.
        await remove(salePath, salePath);
      }
    }
    stage = "cancel_stock_release";
    return await finish();
  } catch (error) {
    logWholesaleProviderError("wholesale_invoice_cancel_failed", invoiceId, stage, error);
    if (error instanceof BlingError) {
      if (error.code === "cancel_access_key_requires_reconciliation") input.onBlocked?.("access_key_requires_reconciliation");
      else if (error.code === "cancel_draft_not_pending") input.onBlocked?.("draft_not_pending");
      else if (error.code === "cancel_draft_still_present") input.onBlocked?.("draft_still_present");
      else if (stage === "cancel_draft_delete" && [400, 403, 422].includes(error.status)) input.onBlocked?.("draft_refused");
      else if (stage === "cancel_sale_delete" && [400, 403, 422].includes(error.status)) input.onBlocked?.("sale_refused");
    }
    try { await call(db, "record_wholesale_cancel_pending", { p_id }); } catch { /* Lease expires; retry reconciles remote IDs. */ }
    return false;
  }
}
