import "server-only";
import { getMercadoPagoCredentials } from "@curtiz/config";
import { MercadoPagoPaymentProvider, type MercadoPagoPayment } from "@curtiz/integrations";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KitTransactionError, kitCall, kitRecord } from "./representative-test-transactions";
import { getStoreRuntimeEnvironment, type RuntimeEnvironment } from "./runtime-environment";
import { readNumber, readString, type UnknownRecord } from "./unknown-data";

const referencePattern = /^KITMG-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/u;
const kitReference = (orderId: string) => `KITMG-${orderId}`;

export function commercialKitCheckoutConfigured(environment: RuntimeEnvironment) {
  return environment.APP_ENV === "production" && environment.REPRESENTATIVE_KIT_CHECKOUT_ENABLED === "true"
    && environment.REPRESENTATIVE_KIT_FULFILLMENT_ENABLED === "true" && environment.BLING_FISCAL_READY === "true"
    && environment.REPRESENTATIVE_KIT_REFUNDS_ENABLED === "true" && environment.BLING_ORDER_SYNC_ENABLED === "true"
    && environment.BLING_INVOICE_SYNC_ENABLED === "true" && environment.BLING_INVOICE_STOCK_AUTOMATION_DISABLED === "true"
    && environment.BLING_INVOICE_SEND_ENABLED === "true" && environment.BLING_INVOICE_TRANSMISSION_MODE === "production"
    && environment.BLING_LIVE_INVOICE_SEND_AUTHORIZED === "true"
    && getMercadoPagoCredentials(environment)?.mode === "production"
    && /^\d{1,30}$/u.test(environment.REPRESENTATIVE_KIT_MP_COLLECTOR_ID?.trim() ?? "");
}

export function commercialKitCollector(environment: RuntimeEnvironment = getStoreRuntimeEnvironment()) {
  const collector = environment.REPRESENTATIVE_KIT_MP_COLLECTOR_ID?.trim() ?? "";
  if (!/^\d{1,30}$/u.test(collector)) throw new KitTransactionError(503);
  return collector;
}

export function commercialKitPaymentProvider(environment: RuntimeEnvironment, transport: typeof fetch = fetch) {
  const credentials = getMercadoPagoCredentials(environment);
  if (credentials?.mode !== "production") throw new KitTransactionError(503);
  return new MercadoPagoPaymentProvider(credentials.accessToken, credentials.mode, transport);
}

export async function reconcileCommercialKitPayment(
  db: SupabaseClient,
  payment: MercadoPagoPayment,
  collector: string,
  orderId?: string
) {
  const match = referencePattern.exec(payment.externalReference);
  const refunded = payment.refunds.filter(refund => ["approved", "completed"].includes(refund.status));
  if (!match || (orderId !== undefined && orderId !== match[1])
    || payment.collectorId !== collector || payment.paymentMethodId !== "pix"
    || payment.currency !== "BRL" || !Number.isSafeInteger(payment.amountInCents) || payment.amountInCents <= 0
    || (payment.dateApproved !== null && !Number.isFinite(Date.parse(payment.dateApproved)))
    || refunded.some(refund => !Number.isSafeInteger(refund.amountInCents))) throw new KitTransactionError();

  return kitRecord(db, "settle_representative_kit_payment", {
    p_order: match[1], p_payment_id: payment.id, p_reference: payment.externalReference, p_amount: payment.amountInCents,
    p_currency: payment.currency, p_status: payment.status, p_paid_at: payment.dateApproved,
    p_refunds: refunded.map(({ id, amountInCents }) => ({ id, amountInCents }))
  });
}

export async function commercialKitOrderPayment(db: SupabaseClient, actor: string, orderId: string) {
  return kitRecord(db, "read_representative_kit_payment", { p_actor: actor, p_order: orderId });
}

export function kitPaymentView(context: UnknownRecord, payment?: MercadoPagoPayment) {
  const state = readString(context, "state");
  const cancellationRequested = context.cancellationRequested === true;
  const pix = context.customerCanPay === true && !cancellationRequested && state === "payment_pending"
    && payment?.expiresAt && Date.parse(payment.expiresAt) > Date.now()
    && payment.pixCopyPaste.length > 0 && payment.pixCopyPaste.length <= 1024
    ? { copyPaste: payment.pixCopyPaste, expiresAt: payment.expiresAt } : null;
  return {
    orderId: readString(context, "orderId"), state, cancellationRequested, canCancelPaid: context.canCancelPaid === true,
    ...(context.canCancelCollection === true ? { canCancelCollection: true } : {}),
    amountInCents: readNumber(context, "amountInCents"), shippingInCents: readNumber(context, "shippingInCents"),
    reservedUntil: readString(context, "reservedUntil"),
    ...(typeof context.collectionMethod === "string" ? { collectionMethod: context.collectionMethod } : {}),
    ...(typeof context.cashTenderedInCents === "number" ? { cashTenderedInCents: context.cashTenderedInCents,
      cashChangeInCents: readNumber(context, "cashChangeInCents") } : {}),
    ...(pix ? { pix } : {})
  };
}

async function readProviderKitPayment(provider: MercadoPagoPaymentProvider, context: UnknownRecord, orderId: string) {
  const providerId = readString(context, "providerPaymentId");
  return providerId ? provider.getPayment(providerId)
    : readString(context, "startedAt") ? provider.findRepresentativeKitPayment(kitReference(orderId)) : null;
}

export async function beginCommercialKitPix(
  db: SupabaseClient, provider: MercadoPagoPaymentProvider, collector: string,
  actor: { id: string; email: string }, orderId: string
) {
  let context = await commercialKitOrderPayment(db, actor.id, orderId);
  if (readString(context, "startedAt")) return refreshCommercialKitPayment(db, provider, collector, actor.id, orderId, context);
  if (await provider.getRepresentativeKitCollectorId() !== collector) throw new KitTransactionError(503);
  const claim = await kitCall(db, "claim_representative_kit_pix", { p_actor: actor.id, p_order: orderId });
  if (claim === null) return refreshCommercialKitPayment(db, provider, collector, actor.id, orderId);
  if (typeof claim !== "object" || !claim || Array.isArray(claim)) throw new KitTransactionError(503);
  context = claim as UnknownRecord;
  const payment = await provider.createRepresentativeKitPix({
    orderId, amountInCents: readNumber(context, "amountInCents"), email: actor.email,
    buyerName: readString(context, "buyerName"), buyerDocument: readString(context, "buyerDocument"),
    expiresAt: readString(context, "expiresAt")
  });
  await reconcileCommercialKitPayment(db, payment, collector, orderId);
  return kitPaymentView(await commercialKitOrderPayment(db, actor.id, orderId), payment);
}

export async function refreshCommercialKitPayment(
  db: SupabaseClient, provider: MercadoPagoPaymentProvider, collector: string, actor: string, orderId: string,
  existing?: UnknownRecord
) {
  const context = existing ?? await commercialKitOrderPayment(db, actor, orderId);
  const payment = await readProviderKitPayment(provider, context, orderId);
  if (!payment) return kitPaymentView(context);
  await reconcileCommercialKitPayment(db, payment, collector, orderId);
  return kitPaymentView(await commercialKitOrderPayment(db, actor, orderId), payment);
}

export async function settleCommercialKitCancellation(
  db: SupabaseClient, provider: MercadoPagoPaymentProvider, collector: string, orderId: string, payment: MercadoPagoPayment
) {
  const confirmed = await reconcileCommercialKitPayment(db, payment, collector, orderId);
  if (confirmed.state !== "payment_pending" || !["pending", "in_process"].includes(payment.status)) return;
  try {
    const cancelled = await provider.cancelPayment(payment.id);
    await reconcileCommercialKitPayment(db, cancelled, collector, orderId);
  } catch {
    // Approval may race with the provider cancellation call. Observe it before releasing a hold.
    const current = await provider.getPayment(payment.id);
    const observed = await reconcileCommercialKitPayment(db, current, collector, orderId);
    if (observed.state === "payment_pending") throw new KitTransactionError(503);
  }
}

export async function cancelCommercialKitPayment(
  db: SupabaseClient, provider: MercadoPagoPaymentProvider, collector: string, actor: string, orderId: string
) {
  const context = await kitRecord(db, "request_representative_kit_payment_cancellation", { p_actor: actor, p_order: orderId });
  if (context.cancellationRequested !== true || !["reserved", "payment_pending"].includes(readString(context, "state"))) {
    return kitPaymentView(context);
  }
  const payment = await readProviderKitPayment(provider, context, orderId);
  if (!payment) return kitPaymentView(context);
  await settleCommercialKitCancellation(db, provider, collector, orderId, payment);
  return kitPaymentView(await commercialKitOrderPayment(db, actor, orderId));
}

export async function recoverCommercialKitPayment(
  db: SupabaseClient, provider: MercadoPagoPaymentProvider, collector: string, job: UnknownRecord
) {
  const orderId = readString(job, "orderId");
  const payment = await readProviderKitPayment(provider, job, orderId);
  if (!payment) {
    await kitCall(db, "defer_representative_kit_payment_check", { p_order: orderId });
    return;
  }
  const expiry = Date.parse(payment.expiresAt ?? readString(job, "expiresAt"));
  if (job.cancellationRequested === true || (Number.isFinite(expiry) && expiry <= Date.now())) {
    await settleCommercialKitCancellation(db, provider, collector, orderId, payment);
    return;
  }
  await reconcileCommercialKitPayment(db, payment, collector, orderId);
}

export async function reconcileCommercialKitRefund(
  db: SupabaseClient, provider: MercadoPagoPaymentProvider, collector: string, job: UnknownRecord, writesEnabled: boolean
) {
  const refundId = readString(job, "refundId");
  const orderId = readString(job, "orderId");
  const paymentId = readString(job, "paymentId");
  let payment = await provider.getPayment(paymentId);
  await reconcileCommercialKitPayment(db, payment, collector, orderId);

  let acknowledged = readString(job, "providerAckId");
  if (!readString(job, "startedAt")) {
    if (!writesEnabled || payment.status !== "approved"
      || payment.refunds.some(refund => !["approved", "completed", "rejected", "failed"].includes(refund.status))) return;
    const baseline = payment.refunds.filter(refund => ["approved", "completed"].includes(refund.status)).map(refund => refund.id).sort();
    if (await kitCall(db, "claim_representative_kit_refund", { p_refund: refundId, p_baseline_ids: baseline }) !== true) return;
    const refund = await provider.refundPayment(paymentId, readNumber(job, "amountInCents"), refundId);
    acknowledged = refund.id;
    if (await kitCall(db, "acknowledge_representative_kit_refund", { p_refund: refundId, p_provider_refund: acknowledged }) !== true) {
      throw new KitTransactionError(503);
    }
    payment = await provider.getPayment(paymentId);
    await reconcileCommercialKitPayment(db, payment, collector, orderId);
  }
  // An external refund can reconcile the monetary ledger. Only an acknowledged
  // provider response can identify which operation produced it.
  if (!acknowledged || await kitCall(db, "finish_representative_kit_refund", {
    p_refund: refundId, p_provider_refund: acknowledged
  }) !== true) throw new KitTransactionError(503);
}
