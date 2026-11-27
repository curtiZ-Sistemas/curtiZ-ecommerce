import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { PrivateRequestError, readPrivateJson, requirePrivateRateLimit } from "@/lib/private-request";
import {
  beginCommercialKitCard, beginCommercialKitPix, cancelCommercialKitPayment, commercialKitCardSession, commercialKitCheckoutConfigured, commercialKitCollector, commercialKitPaymentProvider,
  kitPaymentView, refreshCommercialKitPayment
} from "@/lib/representative-commercial-payments";
import { isRepresentativeKitPostalCode } from "@/lib/representative-resale-scope";
import { KitTransactionError, kitCall, kitRecord } from "@/lib/representative-test-transactions";
import { getStoreRuntimeEnvironment } from "@/lib/runtime-environment";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

const orderId = z.string().uuid();
const gradeTemplate = z.enum(["standard","lower_restock","upper_restock"]);
// Only the token and the choices the buyer makes in the card form: the amount, payer and
// document are always read on the server.
const cardPayment = z.object({
  kind: z.enum(["credit", "debit"]),
  token: z.string().trim().regex(/^[a-zA-Z0-9_-]{8,500}$/u),
  payment_method_id: z.string().trim().regex(/^[a-z0-9_-]{2,50}$/u),
  installments: z.coerce.number().int().min(1).max(48).default(1),
  issuer_id: z.union([z.string().trim().regex(/^[1-9]\d{0,9}$/u), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)])
    .transform(Number).optional()
}).strict();
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve"), variantId: z.string().uuid(), quoteId: z.string().uuid(),
    addressId: z.string().uuid(), quantity: z.number().int().min(1).max(99), idempotencyKey: z.string().uuid() }).strict(),
  z.object({ action: z.literal("reserve_grade"), kitId: z.string().uuid(), template: gradeTemplate,
    quoteId: z.string().uuid(), addressId: z.string().uuid(), quantity: z.number().int().min(1).max(99),
    idempotencyKey: z.string().uuid() }).strict(),
  z.object({ action: z.literal("reserve_collection"), selectionId: z.string().uuid(), template: gradeTemplate.optional(),
    quoteId: z.string().uuid(), addressId: z.string().uuid(), quantity: z.number().int().min(1).max(99),
    idempotencyKey: z.string().uuid(), method: z.enum(["cash","pix","debit_card","credit_card"]),
    cashTenderedInCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
  z.object({ action: z.literal("pix"), orderId }).strict(),
  z.object({ action: z.literal("card_session"), orderId }).strict(),
  z.object({ action: z.literal("card"), orderId, payment: cardPayment }).strict(),
  z.object({ action: z.literal("status"), orderId }).strict(),
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("return"), orderId, quantity: z.number().int().min(1).max(99),
    pairs: z.record(z.string().min(1).max(60),z.number().int().min(1).max(999)).optional(),
    reason: z.string().trim().min(5).max(500), idempotencyKey: z.string().uuid() }).strict(),
  z.object({ action: z.literal("cancel"), orderId }).strict()
]);

const reply = (body: object, status: number) => Response.json(body, {
  status, headers: { "cache-control": "private, no-store" }
});

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) return reply({ message: "Origem não autorizada." }, 403);
  try {
    const parsed = input.safeParse(await readPrivateJson(request, 2048));
    if (!parsed.success) return reply({ message: "Revise os dados do pedido." }, 400);
    const data = parsed.data;
    const auth = await createServerSupabaseClient();
    const session = await auth?.auth.getUser();
    const user = session?.data.user;
    if (!auth || session?.error || !user) throw new KitTransactionError(401);
    const environment = getStoreRuntimeEnvironment();
    const manualFiscal = environment.REPRESENTATIVE_KIT_MANUAL_FISCAL_ENABLED === "true";
    if (["reserve","reserve_grade","reserve_collection","pix","card","card_session"].includes(data.action) && !commercialKitCheckoutConfigured(environment)) {
      return reply({ code: "RESALE_NOT_HOMOLOGATED", message: "A compra de kits aguarda homologação." }, 409);
    }
    if (data.action === "reserve_collection" && environment.REPRESENTATIVE_KIT_COLLECTION_ENABLED !== "true") {
      return reply({ message: "Pagamento no recebimento indisponível para este pedido." }, 409);
    }
    await requirePrivateRateLimit(auth, {
      reserve: "checkout_quote", reserve_grade: "checkout_quote", reserve_collection: "checkout_quote",
      pix: "payment_attempt", card: "payment_attempt", card_session: "payment_reconcile", status: "payment_reconcile", cancel: "order_cancel", list: "customer_write",
      return: "return_request"
    }[data.action]);
    const db = createServiceSupabaseClient();
    if (!db) throw new KitTransactionError(503);
    if (data.action === "list") {
      const orders = await kitCall(db, "list_representative_kit_orders", { p_actor: user.id });
      return reply({ ok: true, orders }, 200);
    }
    if (data.action === "return") {
      if (data.pairs && (data.quantity !== 1 || Object.keys(data.pairs).length < 1 || Object.keys(data.pairs).length > 6)) {
        return reply({ message: "Selecione os pares que deseja devolver." }, 400);
      }
      const details = { p_actor: user.id, p_order: data.orderId, p_reason: data.reason, p_key: data.idempotencyKey };
      const request = data.pairs
        ? await kitRecord(db, "request_representative_kit_pair_return", { ...details, p_pairs: data.pairs })
        : await kitRecord(db, "request_representative_kit_return", { ...details, p_quantity: data.quantity });
      return reply({ ok: true, request }, 200);
    }
    if (data.action === "reserve_collection") {
      const origin = environment.REPRESENTATIVE_KIT_ORIGIN_POSTAL_CODE?.trim() || null;
      if (origin && !isRepresentativeKitPostalCode(origin)) throw new KitTransactionError(503);
      const order = await kitRecord(db, "reserve_representative_kit_own_collection", {
        p_actor: user.id, p_selection: data.selectionId, p_template: data.template ?? null, p_quantity: data.quantity,
        p_quote: data.quoteId, p_address: data.addressId, p_key: data.idempotencyKey, p_origin: origin,
        p_method: data.method, p_cash_tendered: data.cashTenderedInCents ?? null
      });
      return reply({ ok: true, order: kitPaymentView(order) }, 200);
    }
    const provider = commercialKitPaymentProvider(environment);
    const collector = commercialKitCollector(environment);
    if (data.action === "reserve" || data.action === "reserve_grade") {
      const originPostalCode = environment.REPRESENTATIVE_KIT_ORIGIN_POSTAL_CODE?.trim() || null;
      if (originPostalCode && !isRepresentativeKitPostalCode(originPostalCode)) throw new KitTransactionError(503);
      const order = await kitRecord(db, manualFiscal ? "reserve_representative_kit_manual_pix" : "reserve_representative_kit_own_delivery", {
        p_actor: user.id, p_quantity: data.quantity, p_quote: data.quoteId,
        p_address: data.addressId, p_key: data.idempotencyKey, p_origin: originPostalCode,
        p_selection: data.action === "reserve_grade" ? data.kitId : data.variantId,
        p_template: data.action === "reserve_grade" ? data.template : null
      });
      return reply({ ok: true, order: kitPaymentView(order) }, 200);
    }
    if (data.action === "pix" || data.action === "card" || data.action === "card_session") {
      if (!user.email || !user.email_confirmed_at) throw new KitTransactionError(403);
      if (manualFiscal && await kitCall(db,"can_start_representative_kit_manual_pix", {
        p_actor: user.id, p_order: data.orderId
      }) !== true) throw new KitTransactionError(409);
      const payer = { id: user.id, email: user.email };
      const id = data.orderId.toLowerCase();
      // Do not accept a new card charge if its fiscal mapping has not been configured.
      // Existing payment status, refund and cancellation operations remain available.
      const fiscalCardConfigured = (kind: "credit" | "debit") => {
        const method = Number(kind === "credit" ? environment.BLING_REPRESENTATIVE_CREDIT_CARD_PAYMENT_METHOD_ID
          : environment.BLING_REPRESENTATIVE_DEBIT_CARD_PAYMENT_METHOD_ID);
        return Number.isSafeInteger(method) && method > 0;
      };
      if ((data.action === "card" && !fiscalCardConfigured(data.payment.kind))
        || (data.action === "card_session" && !fiscalCardConfigured("credit") && !fiscalCardConfigured("debit"))) {
        return reply({ code: "CARD_FISCAL_NOT_CONFIGURED", message: "Pagamento por cartão temporariamente indisponível. Escolha Pix ou outra forma disponível." }, 409);
      }
      if (data.action === "card_session") {
        return reply({ ok: true, session: await commercialKitCardSession(db, payer, id, environment) }, 200);
      }
      if (data.action === "card") {
        const { kind, token, payment_method_id: paymentMethodId, installments, issuer_id: issuerId } = data.payment;
        const result = await beginCommercialKitCard(db, provider, collector, payer, id, {
          kind, token, paymentMethodId, installments, ...(issuerId !== undefined ? { issuerId } : {})
        });
        return reply({ ok: true, ...result }, 200);
      }
      return reply({ ok: true, order: await beginCommercialKitPix(db, provider, collector, payer, id) }, 200);
    }
    const order = data.action === "cancel"
      ? await cancelCommercialKitPayment(db, provider, collector, user.id, data.orderId.toLowerCase())
      : await refreshCommercialKitPayment(db, provider, collector, user.id, data.orderId.toLowerCase());
    if (data.action === "cancel") return reply({ ok: true, order }, 200);
    const [tracking, returns] = await Promise.all([
      kitCall(db, "read_representative_kit_tracking", { p_actor: user.id, p_order: data.orderId }),
      kitCall(db, "list_representative_kit_returns", { p_actor: user.id, p_order: data.orderId })
    ]);
    return reply({ ok: true, order, tracking, returns }, 200);
  } catch (error) {
    const status = error instanceof KitTransactionError || error instanceof PrivateRequestError ? error.status : 503;
    // A fixed, actionable reason: the buyer has no valid CPF or CNPJ for the provider. The document
    // itself is never part of the answer.
    if (error instanceof KitTransactionError && error.reason === "payer_document_required") {
      return reply({ code: "PAYER_DOCUMENT_REQUIRED",
        message: "Complete seu CPF ou CNPJ no cadastro para pagar com Pix ou cartão." }, 409);
    }
    return reply({ message: status >= 500 ? "Não foi possível confirmar o estado. Consulte o pedido antes de tentar novamente."
      : "Não foi possível concluir a operação do kit." }, status);
  }
}
