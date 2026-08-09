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
  const { payment_id, reason } = (await request.json().catch(() => ({}))) as {
    payment_id?: string;
    reason?: string;
  };
  if (
    !payment_id ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(payment_id) ||
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
  if (paymentError || !payment || payment.status !== "approved") {
    return json({ error: "payment_not_refundable" }, 409);
  }

  const { data: existing } = await db
    .from("payment_refunds")
    .select("id,status,provider_refund_id,attempts")
    .eq("payment_id", payment.id)
    .maybeSingle();
  if (existing?.status === "completed") {
    return json({ ok: true, duplicate: true, refund_id: existing.provider_refund_id });
  }
  const refundId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    const { error: insertError } = await db.from("payment_refunds").insert({
      id: refundId,
      payment_id: payment.id,
      order_id: payment.order_id,
      amount: payment.amount,
      currency: payment.currency,
      status: "pending",
      reason: reason.trim(),
      requested_by: userId,
      attempts: 1
    });
    if (insertError && insertError.code !== "23505") return json({ error: "refund_unavailable" }, 503);
  } else {
    const { error: retryError } = await db
      .from("payment_refunds")
      .update({ status: "pending", attempts: Number(existing.attempts ?? 0) + 1, error_summary: null })
      .eq("id", refundId);
    if (retryError) return json({ error: "refund_unavailable" }, 503);
  }
  const response = await mercadoPagoRequest(
    `/v1/payments/${encodeURIComponent(payment_id)}/refunds`,
    { method: "POST", body: JSON.stringify({ amount: Number(payment.amount) }) },
    payment.id
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
    p_requested_by: userId
  });
  if (finalizeError || finalized !== true) return json({ error: "refund_reconciliation_failed" }, 503);
  return json({ ok: true, refund_id: providerRefundId });
});
