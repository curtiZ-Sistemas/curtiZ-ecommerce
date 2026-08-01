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

  const { error: eventError } = await db.from("payment_events").insert({
    provider: "mercadopago",
    provider_event_id: eventId,
    event_type: payload.type ?? "payment",
    payload_hash: payloadHash,
    signature_valid: true,
    processing_status: "received"
  });
  if (eventError?.code === "23505")
    return json({ ok: true, duplicate: true, request_id: correlationId });

  const providerResponse = await mercadoPagoRequest(
    `/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      method: "GET"
    }
  );
  if (!providerResponse.ok)
    return json({ error: "provider_unavailable", request_id: correlationId }, 202);
  const payment = await providerResponse.json();

  const { data: localPayment } = await db
    .from("payments")
    .select("id, order_id, amount, currency, external_reference, status")
    .eq("external_reference", payment.external_reference)
    .single();
  if (
    !localPayment ||
    Number(localPayment.amount) !== Number(payment.transaction_amount) ||
    localPayment.currency !== payment.currency_id
  ) {
    await db
      .from("payment_events")
      .update({ processing_status: "manual_review", processed_at: new Date().toISOString() })
      .eq("provider_event_id", eventId);
    return json({ ok: true, review: true, request_id: correlationId });
  }

  const normalized = payment.status === "approved" ? "approved" : payment.status;
  await db
    .from("payments")
    .update({
      provider_payment_id: paymentId,
      status: normalized,
      paid_at: payment.date_approved
    })
    .eq("id", localPayment.id);
  if (normalized === "approved" && localPayment.status !== "approved") {
    await db.rpc("convert_order_reservations", { p_order_id: localPayment.order_id });
    await db
      .from("orders")
      .update({ status: "payment_approved", payment_status: "approved" })
      .eq("id", localPayment.order_id);
  }
  await db
    .from("payment_events")
    .update({ processing_status: "processed", processed_at: new Date().toISOString() })
    .eq("provider_event_id", eventId);
  return json({ ok: true, request_id: correlationId });
});
