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
  const normalizedStatus = ["approved", "rejected", "cancelled", "refunded", "charged_back"]
    .includes(String(payment.status)) ? String(payment.status) : "in_review";
  const { data: result, error: reconcileError } = await db.rpc("finalize_mercadopago_payment", {
    p_provider_event_id: eventId,
    p_provider_payment_id: paymentId,
    p_external_reference: String(payment.external_reference ?? ""),
    p_amount: Number(payment.transaction_amount),
    p_currency: String(payment.currency_id ?? ""),
    p_status: normalizedStatus,
    p_paid_at: payment.date_approved ?? null
  });
  if (reconcileError) return json({ error: "payment_reconciliation_failed", request_id: correlationId }, 503);
  return json({ ok: true, review: result === "manual_review", request_id: correlationId });
});
