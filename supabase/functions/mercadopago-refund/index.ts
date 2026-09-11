import { corsHeaders, json } from "../_shared/http.ts";
import { mercadoPagoRequest } from "../_shared/mercadopago.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { integrationDisabledPayload, isMercadoPagoEnabled } from "../_shared/integrations.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isMercadoPagoEnabled()) return json(integrationDisabledPayload(), 503);
  const auth = userClient(request.headers.get("authorization") ?? "");
  const { data: claims } = await auth.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { data: allowed } = await auth.rpc("has_permission", { permission_code: "finance.reconcile" });
  if (!allowed) return json({ error: "forbidden" }, 403);
  const { payment_id, reason, amount_in_cents, idempotency_key } = (await request.json().catch(() => ({}))) as {
    payment_id?: string;
    reason?: string;
    amount_in_cents?: number;
    idempotency_key?: string;
  };
  if (
    !payment_id ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(payment_id) ||
    !idempotency_key ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotency_key) ||
    (amount_in_cents !== undefined && (!Number.isSafeInteger(amount_in_cents) || amount_in_cents <= 0)) ||
    typeof reason !== "string" ||
    reason.trim().length < 3 ||
    reason.trim().length > 500
  ) return json({ error: "invalid_refund" }, 400);

  const db = serviceClient();
  const { data: payment, error: paymentError } = await db
    .from("payments")
    .select("id,order_id,provider_payment_id,status,amount,currency")
    .eq("provider", "mercadopago")
    .eq("provider_payment_id", payment_id)
    .single();
  if (paymentError || !payment || !["approved", "refunded"].includes(payment.status)) {
    return json({ error: "payment_not_refundable" }, 409);
  }
  const { data: completedRefunds, error: completedError } = await db
    .from("payment_refunds")
    .select("amount")
    .eq("payment_id", payment.id).eq("status", "completed");
  if (completedError) return json({ error: "refund_unavailable" }, 503);
  const completedAmount = (completedRefunds ?? []).reduce((total, refund) => total + Number(refund.amount), 0);
  const remainingInCents = Math.round((Number(payment.amount) - completedAmount) * 100);
  const refundAmountInCents = amount_in_cents ?? remainingInCents;
  if (!Number.isSafeInteger(refundAmountInCents) || refundAmountInCents <= 0 || refundAmountInCents > remainingInCents) {
    return json({ error: "invalid_refund_amount" }, 409);
  }
  const refundAmount = refundAmountInCents / 100;
  const { data: refundId, error: beginError } = await db.rpc("begin_mercadopago_refund", {
    p_payment_id: payment.id,
    p_requested_by: userId,
    p_refund_amount: refundAmount,
    p_idempotency_key: idempotency_key,
    p_reason: reason.trim()
  });
  if (beginError || typeof refundId !== "string") return json({ error: "refund_unavailable" }, 409);
  const { data: existing, error: existingError } = await db
    .from("payment_refunds")
    .select("id,status,provider_refund_id")
    .eq("id", refundId).single();
  if (existingError || !existing) return json({ error: "refund_unavailable" }, 503);
  if (existing?.status === "completed") {
    return json({ ok: true, duplicate: true, refund_id: existing.provider_refund_id });
  }
  const response = await mercadoPagoRequest(
    `/v1/payments/${encodeURIComponent(payment_id)}/refunds`,
    { method: "POST", body: JSON.stringify({ amount: refundAmount }) },
    idempotency_key
  );
  if (!response.ok) {
    await db.from("payment_refunds").update({ status: "failed", error_summary: "provider_rejected" }).eq("id", refundId);
    return json({ error: "refund_failed" }, 502);
  }
  const providerRefund = await response.json();
  const providerRefundId = String(providerRefund.id ?? "");
  if (!providerRefundId) {
    await db.from("payment_refunds").update({ status: "failed", error_summary: "invalid_provider_response" }).eq("id", refundId);
    return json({ error: "invalid_provider_response" }, 502);
  }
  const { data: finalized, error: finalizeError } = await db.rpc("finalize_mercadopago_refund", {
    p_payment_id: payment.id,
    p_provider_refund_id: providerRefundId,
    p_requested_by: userId,
    p_refund_amount: refundAmount,
    p_idempotency_key: idempotency_key
  });
  if (finalizeError || finalized !== true) return json({ error: "refund_reconciliation_failed" }, 503);
  return json({ ok: true, refund_id: providerRefundId });
});
