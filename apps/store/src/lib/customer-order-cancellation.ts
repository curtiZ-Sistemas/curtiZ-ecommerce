import "server-only";
import { MercadoPagoTestPaymentProvider } from "@curtiz/integrations";
import { createServiceSupabaseClient } from "./supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "./unknown-data";

const pending = { ok: true, status: "refund_pending", message: "Seu cancelamento foi recebido. O reembolso está sendo processado." };

export async function cancelCustomerOrder(orderId: string, customerId: string) {
  const db = createServiceSupabaseClient();
  if (!db) return { statusCode: 503, body: { message: "Não foi possível iniciar o cancelamento." } };
  const claim = readQueryResult(await db.rpc("begin_customer_order_cancellation", { p_order_id: orderId, p_customer_id: customerId }));
  if (claim.error || !isUnknownRecord(claim.data)) return { statusCode: 409, body: {
    message: "Este pedido não está disponível para cancelamento.", code: "CANCELLATION_NOT_ALLOWED"
  } };
  const data = claim.data;
  const done = readString(data, "status");
  if (["cancelled", "refunded"].includes(done)) return { statusCode: 200, body: { ok: true, status: done,
    message: done === "cancelled" ? "Pedido cancelado." : "Pedido cancelado e reembolso concluído." } };
  const pendingResult = () => ({ statusCode: 202, body: readString(data, "status") === "cancellation_requested"
    ? { ok: true, status: "cancellation_requested", message: "Seu cancelamento foi recebido. Estamos verificando o pagamento." } : pending });
  if (data.busy === true) return pendingResult();
  const finish = async (paid: boolean) => {
    const result = readQueryResult(await db.rpc("prepare_customer_order_cancellation", {
      p_order_id: orderId, p_customer_id: customerId, p_paid: paid
    }));
    if (result.error) throw new Error("cancellation_not_confirmed");
    return result;
  };
  try {
    const providerId = readString(data, "providerPaymentId");
    if (!providerId) {
      if (data.paymentInFlight === true || data.paid === true) throw new Error("payment_in_flight");
      await finish(false);
      return { statusCode: 200, body: { ok: true, status: "cancelled", message: "Pedido cancelado." } };
    }
    const provider = new MercadoPagoTestPaymentProvider(process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim() ?? "");
    let payment = await provider.getPayment(providerId);
    const matches = () => payment.id === providerId && payment.externalReference === readString(data, "orderCode")
      && payment.amountInCents === readNumber(data, "amountInCents") && payment.currency === "BRL";
    if (!matches()) throw new Error("payment_mismatch");
    if (["pending", "in_process", "authorized", "in_review"].includes(payment.status)) {
      payment = await provider.cancelPayment(providerId);
      if (!matches()) throw new Error("payment_mismatch");
    }
    if (["cancelled", "rejected", "expired"].includes(payment.status) && data.paid !== true) {
      await finish(false);
      return { statusCode: 200, body: { ok: true, status: "cancelled", message: "Pedido cancelado." } };
    }
    if (!["approved", "refunded"].includes(payment.status)) throw new Error("payment_verification_required");
    data.status = "refund_pending";
    const prepared = await finish(true);
    if (!isUnknownRecord(prepared.data)) throw new Error("refund_not_prepared");
    const key = readString(prepared.data, "idempotencyKey");
    const confirmedRefund = payment.refunds.find(refund => refund.amountInCents === payment.amountInCents
      && ["approved", "completed"].includes(refund.status));
    if (payment.status === "refunded" && !confirmedRefund) throw new Error("refund_requires_review");
    const refund = confirmedRefund ?? await provider.refundPayment(providerId, payment.amountInCents, key);
    const final = readQueryResult(await db.rpc("finalize_mercadopago_refund", {
      p_payment_id: readString(prepared.data, "paymentId"), p_provider_refund_id: refund.id,
      p_requested_by: customerId, p_refund_amount: payment.amountInCents / 100, p_idempotency_key: key
    }));
    if (final.error || final.data !== true) throw new Error("refund_not_finalized");
    return { statusCode: 200, body: { ok: true, status: "refunded", message: "Pedido cancelado e reembolso concluído." } };
  } catch {
    return pendingResult();
  }
}
