import "server-only";
import { randomUUID, createHash, createHmac } from "node:crypto";
import { getMercadoPagoCredentials } from "@curtiz/config";
import { MercadoPagoPaymentProvider, type MercadoPagoPayment } from "@curtiz/integrations";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUnknownRecord, readNumber, readString } from "./unknown-data";

export class KitTransactionError extends Error {
  constructor(readonly status = 409) { super("kit_transaction_unavailable"); }
}

export async function kitCall(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await db.rpc(name, args);
  if (result.error) throw new KitTransactionError(result.error.code === "42501" ? 403
    : ["P0001", "23514", "23505"].includes(result.error.code) ? 409 : 503);
  return result.data;
}
export async function kitRecord(db: SupabaseClient, name: string, args: Record<string, unknown>) {
  const result = await kitCall(db, name, args);
  if (!isUnknownRecord(result)) throw new KitTransactionError(404);
  return result;
}
export function kitTestProvider() {
  const credentials = getMercadoPagoCredentials();
  if (credentials?.mode !== "test") throw new KitTransactionError();
  return new MercadoPagoPaymentProvider(credentials.accessToken, "test");
}
export function assertKitPayment(context: Record<string, unknown>, payment: MercadoPagoPayment) {
  if (context.mode !== "test" || payment.currency !== "BRL" || payment.amountInCents !== readNumber(context, "amountInCents")
    || payment.externalReference !== readString(context, "reference")
    || (readString(context, "providerPaymentId") && payment.id !== context.providerPaymentId)) throw new KitTransactionError();
}
export async function persistKitPayment(db: SupabaseClient, context: Record<string, unknown>, lock: string, payment: MercadoPagoPayment) {
  assertKitPayment(context, payment);
  const state = readString(context, "state");
  // Never regress a completed payment from a delayed pending notification.
  if ((["paid", "refunded"].includes(state) && ["pending", "in_process"].includes(payment.status))
    || (state === "refunded" && payment.status === "refunded")) {
    if (await kitCall(db, "release_kit_test_lease", { p_order: context.orderId, p_lock: lock }) !== true) throw new KitTransactionError();
    return true;
  }
  if (payment.refunds.filter(r => ["approved", "completed"].includes(r.status))
    .reduce((sum, r) => sum + r.amountInCents, 0) !== readNumber(context, "refundedInCents")) throw new KitTransactionError();
  const confirmed = await kitCall(db, "settle_kit_test_payment", {
    p_order: context.orderId, p_lock: lock, p_provider: payment.id, p_reference: payment.externalReference,
    p_amount: payment.amountInCents, p_currency: payment.currency, p_live: false,
    p_status: payment.status === "expired" ? "cancelled" : payment.status
  });
  if (confirmed !== true) throw new KitTransactionError();
  if (["pending", "in_process"].includes(payment.status)) {
    if (await kitCall(db, "store_kit_test_instructions", { p_order: context.orderId, p_provider: payment.id,
      p_expires: payment.expiresAt, p_copy: payment.pixCopyPaste, p_qr: payment.pixQrCodeBase64 }) !== true) throw new KitTransactionError();
  }
  return true;
}
export async function reconcileKitTestPayment(db: SupabaseClient, payment: MercadoPagoPayment) {
  const match = /^KITTEST-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.exec(payment.externalReference);
  if (!match) throw new KitTransactionError();
  const lock = randomUUID();
  const context = await kitRecord(db, "claim_kit_test_reconciliation", { p_order: match[1], p_lock: lock });
  return persistKitPayment(db, context, lock, payment);
}
export async function beginKitPix(db: SupabaseClient, actor: { id: string; email: string }, orderId: string, document: string, name: string) {
  const provider = kitTestProvider();
  const fingerprintKey = process.env.RATE_LIMIT_HMAC_KEY?.trim();
  if (!fingerprintKey || fingerprintKey.length < 32) throw new KitTransactionError(503);
  const fingerprint = createHmac("sha256", fingerprintKey).update("kit-payment:v1:")
    .update(JSON.stringify({ method: "pix", actor: actor.id, document })).digest("hex");
  const lock = randomUUID();
  const context = await kitRecord(db, "claim_kit_test_creation", { p_actor: actor.id, p_order: orderId, p_fingerprint: fingerprint, p_lock: lock });
  let payment: MercadoPagoPayment;
  if (readString(context, "providerPaymentId")) payment = await provider.getPayment(readString(context, "providerPaymentId"));
  else {
    if (context.state && context.state !== "reserved") throw new KitTransactionError();
    const created = await provider.createPayment({ aggregate: "kit_orders", orderId, orderCode: readString(context, "reference"),
      amountInCents: readNumber(context, "amountInCents"), currency: "BRL", idempotencyKey: readString(context, "idempotencyKey"),
      customerEmail: actor.email, customerName: name, customerDocument: document, entityType: "individual", paymentMethodId: "pix", installments: 1 });
    assertKitPayment(context, created);
    payment = await provider.getPayment(created.id);
  }
  await persistKitPayment(db, { ...context, refundedInCents: 0 }, lock, payment);
}
export async function cancelKitTestOrder(db: SupabaseClient, actor: string, orderId: string) {
  const provider = kitTestProvider();
  const context = await kitRecord(db, "read_kit_test_transaction", { p_actor: actor, p_order: orderId });
  if (["cancelled", "refunded"].includes(readString(context, "state"))) return;
  if (!readString(context, "providerPaymentId")) {
    if (await kitCall(db, "cancel_unstarted_kit_test_transaction", { p_actor: actor, p_order: orderId }) !== true) throw new KitTransactionError();
    return; // An uncertain provider create must be reconciled instead of releasing stock.
  }
  let payment = await provider.getPayment(readString(context, "providerPaymentId"));
  assertKitPayment(context, payment);
  if (["approved", "refunded"].includes(payment.status)) {
    const hex = createHash("sha256").update(`kit_cancel:${orderId}`).digest("hex");
    const key = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    await refundKitTestOrder(db, actor, orderId, key, readNumber(context, "remainingInCents"));
    return;
  }
  if (["pending", "in_process"].includes(payment.status)) payment = await provider.cancelPayment(payment.id);
  if (!["cancelled", "expired", "rejected"].includes(payment.status)) throw new KitTransactionError();
  await reconcileKitTestPayment(db, payment);
}
export async function refundKitTestOrder(db: SupabaseClient, actor: string, orderId: string, key: string, amount: number) {
  const provider = kitTestProvider();
  const prepared = await kitRecord(db, "prepare_kit_test_refund", { p_actor: actor, p_order: orderId, p_key: key, p_amount: amount });
  if (prepared.state === "completed") return;
  const context = await kitRecord(db, "read_kit_test_transaction", { p_actor: actor, p_order: orderId });
  const details = await kitRecord(db, "read_kit_test_refund", { p_actor: actor, p_order: orderId, p_key: key });
  const payment = await provider.getPayment(readString(prepared, "providerPaymentId"));
  assertKitPayment(context, payment);
  if (!Array.isArray(details.completedRefundIds) || details.completedRefundIds.some(id => typeof id !== "string")) throw new KitTransactionError();
  const known = new Set(details.completedRefundIds);
  const outstanding = payment.refunds.filter(r => !known.has(r.id) && !["rejected", "failed"].includes(r.status));
  if (outstanding.length > 1 || outstanding.some(r => r.amountInCents !== amount || !["approved", "completed"].includes(r.status))) throw new KitTransactionError();
  const total = payment.refunds.filter(r => ["approved", "completed"].includes(r.status)).reduce((sum, r) => sum + r.amountInCents, 0);
  if (total !== readNumber(context, "refundedInCents") + (outstanding.length ? amount : 0)) throw new KitTransactionError();
  if (!outstanding.length && (!Number.isFinite(Date.parse(readString(details, "createdAt")))
    || Date.now() - Date.parse(readString(details, "createdAt")) >= 23 * 3600_000 || payment.status !== "approved")) throw new KitTransactionError();
  const refund = outstanding[0] ?? await provider.refundPayment(payment.id, amount, key);
  if (await kitCall(db, "finish_kit_test_refund", { p_order: orderId, p_key: key, p_provider_refund: refund.id, p_amount: amount }) !== true) throw new KitTransactionError();
}
