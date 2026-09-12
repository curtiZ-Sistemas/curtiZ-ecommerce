import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isMercadoPagoTestCredential, MercadoPagoTestPaymentProvider } from "@curtiz/integrations";
import { NextResponse } from "next/server";
import { normalizeMercadoPagoStatus } from "@/lib/mercadopago-payment";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

const signed = (request: Request, dataId: string, secret: string) => {
  const signature = request.headers.get("x-signature") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  const parts = new Map(signature.split(",").map((part) => part.trim().split("=", 2) as [string, string]));
  const timestamp = parts.get("ts") ?? "";
  const received = parts.get("v1") ?? "";
  if (!timestamp || !received || !requestId || !/^[a-f0-9]{64}$/iu.test(received)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Date.now() / 1_000 - timestampSeconds) > 300) return false;
  const expected = createHmac("sha256", secret).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`).digest();
  return timingSafeEqual(expected, Buffer.from(received, "hex"));
};

export async function POST(request: Request) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim();
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
  if (!secret || !isMercadoPagoTestCredential(accessToken)) return NextResponse.json({ ok: false }, { status: 503 });
  const url = new URL(request.url);
  const rawBody = await request.text();
  const body: unknown = (() => {
    try { return JSON.parse(rawBody) as unknown; } catch { return null; }
  })();
  const bodyId = body && typeof body === "object" && "data" in body && body.data && typeof body.data === "object" && "id" in body.data
    ? String(body.data.id) : "";
  const dataId = url.searchParams.get("data.id") ?? bodyId;
  if (!dataId || !signed(request, dataId, secret)) return NextResponse.json({ ok: false }, { status: 401 });
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });
  const bodyRecord = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const eventId = typeof bodyRecord.id === "number" || typeof bodyRecord.id === "string"
    ? String(bodyRecord.id)
    : request.headers.get("x-request-id") ?? "";
  if (!eventId) return NextResponse.json({ ok: false }, { status: 400 });
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const existingEvent = await db.from("payment_events")
    .select("processing_status,attempts,payload_hash")
    .eq("provider", "mercadopago").eq("provider_event_id", eventId).maybeSingle();
  if (existingEvent.error) return NextResponse.json({ ok: false }, { status: 503 });
  if (existingEvent.data) {
    if (existingEvent.data.payload_hash !== payloadHash) return NextResponse.json({ ok: false }, { status: 409 });
    const processingStatus: unknown = existingEvent.data.processing_status;
    if (typeof processingStatus === "string" && ["processed", "manual_review"].includes(processingStatus)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    const retry = await db.from("payment_events").update({
      processing_status: "received", attempts: Number(existingEvent.data.attempts ?? 0) + 1,
      error_summary: null
    }).eq("provider", "mercadopago").eq("provider_event_id", eventId);
    if (retry.error) return NextResponse.json({ ok: false }, { status: 503 });
  } else {
    const stored = await db.from("payment_events").insert({
      provider: "mercadopago", provider_event_id: eventId,
      event_type: typeof bodyRecord.type === "string" ? bodyRecord.type : "payment",
      payload_hash: payloadHash, signature_valid: true, processing_status: "received", attempts: 1
    });
    if (stored.error) return NextResponse.json({ ok: false }, { status: 503 });
  }
  try {
    const payment = await new MercadoPagoTestPaymentProvider(accessToken).getPayment(dataId);
    const method = [payment.paymentTypeId, payment.paymentMethodId].filter(Boolean).join(":");
    const statusDetail = payment.status === "expired" ? "expired" : payment.statusDetail;
    const result = await db.rpc("finalize_mercadopago_payment", { p_provider_event_id: eventId,
      p_provider_payment_id: payment.id, p_external_reference: payment.externalReference,
      p_amount: payment.amountInCents / 100, p_currency: payment.currency,
      p_status: normalizeMercadoPagoStatus(payment.status), p_paid_at: payment.dateApproved,
      p_provider_fee: payment.providerFeeInCents === null ? null : payment.providerFeeInCents / 100,
      p_net_received_amount: payment.netReceivedInCents === null ? null : payment.netReceivedInCents / 100,
      p_payment_method: method || null, p_installments: payment.installments,
      p_status_detail: statusDetail || null });
    if (result.error) return NextResponse.json({ ok: false }, { status: 503 });
    if (result.data === "manual_review") return NextResponse.json({ ok: true, review: true });
    for (const refund of payment.refunds) {
      if (!["approved", "completed"].includes(refund.status)) continue;
      const reconciled = await db.rpc("reconcile_mercadopago_provider_refund", {
        p_provider_payment_id: payment.id, p_provider_refund_id: refund.id,
        p_amount: refund.amountInCents / 100, p_provider_event_id: eventId,
        p_completed_at: refund.dateCreated
      });
      if (reconciled.error) {
        await db.from("payment_events").update({ processing_status: "retry", error_summary: "refund_reconciliation_failed" })
          .eq("provider", "mercadopago").eq("provider_event_id", eventId);
        return NextResponse.json({ ok: false }, { status: 503 });
      }
    }
    return NextResponse.json({ ok: true, review: false });
  } catch {
    await db.from("payment_events").update({ processing_status: "retry", error_summary: "provider_unavailable" })
      .eq("provider", "mercadopago").eq("provider_event_id", eventId);
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
