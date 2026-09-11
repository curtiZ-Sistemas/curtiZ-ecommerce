import { corsHeaders, json, requestId } from "../_shared/http.ts";
import { mercadoPagoRequest, validateMercadoPagoSignature } from "../_shared/mercadopago.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { integrationDisabledPayload, isMercadoPagoEnabled } from "../_shared/integrations.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const correlationId = requestId(request);
  if (!isMercadoPagoEnabled()) return json(integrationDisabledPayload(correlationId), 503);
  const raw = await request.text();
  let payload: { id?: string; data?: { id?: string }; type?: string };
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json", request_id: correlationId }, 400);
  }
  const eventId = String(payload.id ?? payload.data?.id ?? "");
  const paymentId = String(payload.data?.id ?? "");
  if (!eventId || !paymentId || !(await validateMercadoPagoSignature(request, paymentId))) {
    return json({ error: "invalid_signature", request_id: correlationId }, 401);
  }

  const db = serviceClient();
  const payloadHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  let attempt = 1;
  const { error: eventError } = await db.from("payment_events").insert({
    provider: "mercadopago",
    provider_event_id: eventId,
    event_type: payload.type ?? "payment",
    payload_hash: payloadHash,
    signature_valid: true,
    processing_status: "received",
    attempts: attempt
  });
  if (eventError?.code === "23505") {
    const { data: existingEvent, error: existingError } = await db
      .from("payment_events")
      .select("processing_status,attempts,payload_hash")
      .eq("provider", "mercadopago")
      .eq("provider_event_id", eventId)
      .single();
    if (existingError || !existingEvent || existingEvent.payload_hash !== payloadHash) {
      return json({ error: "event_conflict", request_id: correlationId }, 409);
    }
    if (["processed", "manual_review"].includes(existingEvent.processing_status)) {
      return json({ ok: true, duplicate: true, request_id: correlationId });
    }
    attempt = Number(existingEvent.attempts ?? 0) + 1;
    const { error: retryError } = await db
      .from("payment_events")
      .update({ processing_status: "received", attempts: attempt, error_summary: null })
      .eq("provider", "mercadopago")
      .eq("provider_event_id", eventId);
    if (retryError) return json({ error: "event_persistence_failed", request_id: correlationId }, 503);
  }
  if (eventError) return json({ error: "event_persistence_failed", request_id: correlationId }, 503);

  const providerResponse = await mercadoPagoRequest(
    `/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      method: "GET"
    }
  );
  if (!providerResponse.ok) {
    await db.from("payment_events").update({ processing_status: "retry", attempts: attempt, error_summary: "provider_unavailable" }).eq("provider", "mercadopago").eq("provider_event_id", eventId);
    return json({ error: "provider_unavailable", request_id: correlationId }, 202);
  }
  const payment = await providerResponse.json();
  const feeDetails = Array.isArray(payment.fee_details) ? payment.fee_details : null;
  const providerFee = feeDetails === null ? null : feeDetails.reduce<number | null>((total, entry) => {
    const amount = entry && typeof entry === "object" ? Number(entry.amount) : Number.NaN;
    return total === null || !Number.isFinite(amount) || amount < 0 ? null : total + amount;
  }, 0);
  const netReceived = Number(payment.transaction_details?.net_received_amount);
  const installments = Number(payment.installments);
  const method = [payment.payment_type_id, payment.payment_method_id]
    .filter((value) => typeof value === "string" && value.length > 0).join(":");
  const providerStatus = String(payment.status);
  const normalizedStatus = providerStatus === "expired"
    ? "cancelled"
    : ["pending", "approved", "rejected", "cancelled", "refunded", "charged_back"]
      .includes(providerStatus) ? providerStatus : "in_review";
  const { data: result, error: reconcileError } = await db.rpc("finalize_mercadopago_payment", {
    p_provider_event_id: eventId,
    p_provider_payment_id: paymentId,
    p_external_reference: String(payment.external_reference ?? ""),
    p_amount: Number(payment.transaction_amount),
    p_currency: String(payment.currency_id ?? ""),
    p_status: normalizedStatus,
    p_paid_at: payment.date_approved ?? null,
    p_provider_fee: providerFee,
    p_net_received_amount: Number.isFinite(netReceived) && netReceived >= 0 ? netReceived : null,
    p_payment_method: method || null,
    p_installments: Number.isSafeInteger(installments) && installments > 0 ? installments : null,
    p_status_detail: typeof payment.status_detail === "string" ? payment.status_detail : null
  });
  if (reconcileError) return json({ error: "payment_reconciliation_failed", request_id: correlationId }, 503);
  if (result === "manual_review") return json({ ok: true, review: true, request_id: correlationId });
  if (Array.isArray(payment.refunds)) {
    for (const providerRefund of payment.refunds) {
      const providerRefundId = providerRefund && typeof providerRefund === "object" ? String(providerRefund.id ?? "") : "";
      const refundAmount = providerRefund && typeof providerRefund === "object" ? Number(providerRefund.amount) : Number.NaN;
      const refundStatus = providerRefund && typeof providerRefund === "object" ? String(providerRefund.status ?? "approved") : "";
      if (!providerRefundId || !Number.isFinite(refundAmount) || refundAmount <= 0 || !["approved", "completed"].includes(refundStatus)) continue;
      const { error: refundError } = await db.rpc("reconcile_mercadopago_provider_refund", {
        p_provider_payment_id: paymentId,
        p_provider_refund_id: providerRefundId,
        p_amount: refundAmount,
        p_provider_event_id: eventId,
        p_completed_at: providerRefund.date_created ?? null
      });
      if (refundError) {
        await db.from("payment_events").update({ processing_status: "retry", error_summary: "refund_reconciliation_failed" })
          .eq("provider", "mercadopago").eq("provider_event_id", eventId);
        return json({ error: "refund_reconciliation_failed", request_id: correlationId }, 503);
      }
    }
  }
  return json({ ok: true, review: false, request_id: correlationId });
});
