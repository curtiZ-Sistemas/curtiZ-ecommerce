import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isMercadoPagoTestCredential, MercadoPagoTestPaymentProvider } from "@curtiz/integrations";
import { readBoundedBody, RequestBodyError } from "@curtiz/security";
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

const reply = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim();
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
  if (!secret || !isMercadoPagoTestCredential(accessToken)) return reply({ ok: false }, 503);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return reply({ ok: false }, 415);
  }
  const url = new URL(request.url);
  const queryId = url.searchParams.get("data.id") ?? "";
  if (queryId && !signed(request, queryId, secret)) return reply({ ok: false }, 401);
  let rawBody: string;
  try { rawBody = new TextDecoder().decode(await readBoundedBody(request, 64 * 1024)); }
  catch (error) { return reply({ ok: false }, error instanceof RequestBodyError ? error.status : 400); }
  const body: unknown = (() => {
    try { return JSON.parse(rawBody) as unknown; } catch { return null; }
  })();
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ ok: false }, 400);
  const bodyId = body && typeof body === "object" && "data" in body && body.data && typeof body.data === "object" && "id" in body.data
    ? String(body.data.id) : "";
  if (queryId && bodyId && queryId.toLowerCase() !== bodyId.toLowerCase()) return reply({ ok: false }, 400);
  const dataId = queryId || bodyId;
  if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(dataId) || !signed(request, dataId, secret)) return reply({ ok: false }, 401);
  const db = createServiceSupabaseClient();
  if (!db) return reply({ ok: false }, 503);
  const bodyRecord = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const eventId = typeof bodyRecord.id === "number" || typeof bodyRecord.id === "string"
    ? String(bodyRecord.id)
    : request.headers.get("x-request-id") ?? "";
  if (!eventId || eventId.length > 200) return reply({ ok: false }, 400);
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const claim = await db.rpc("claim_payment_webhook", {
    p_event_id: eventId, p_payment_id: dataId, p_payload_hash: payloadHash,
    p_event_type: typeof bodyRecord.type === "string" ? bodyRecord.type : "payment"
  });
  if (claim.error) return reply({ ok: false }, 503);
  if (claim.data === "duplicate") return reply({ ok: true, duplicate: true });
  if (claim.data === "hash_conflict") return reply({ ok: false }, 409);
  if (claim.data === "limited") return reply({ ok: false }, 429);
  if (typeof claim.data !== "string" || !/^acquired:[0-9a-f-]{36}$/u.test(claim.data)) return reply({ ok: false }, 503);
  const leaseToken = claim.data.slice("acquired:".length);
  const finish = (success: boolean, errorCode: string | null = null) => db.rpc("finish_payment_webhook", {
    p_event_id: eventId, p_lease_token: leaseToken, p_success: success, p_error_code: errorCode
  });
  try {
    const payment = await new MercadoPagoTestPaymentProvider(accessToken).getPayment(dataId);
    if (payment.id.toLowerCase() !== dataId.toLowerCase()) throw new Error("provider_payment_mismatch");
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
    if (result.error || !["processed", "manual_review"].includes(String(result.data))) {
      await finish(false, "payment_reconciliation_failed");
      return reply({ ok: false }, 503);
    }
    if (result.data === "manual_review") {
      const completed = await finish(true);
      const ok = !completed.error && completed.data === true;
      return reply({ ok, review: true }, ok ? 200 : 503);
    }
    for (const refund of payment.refunds) {
      if (!["approved", "completed"].includes(refund.status)) continue;
      const reconciled = await db.rpc("reconcile_mercadopago_provider_refund", {
        p_provider_payment_id: payment.id, p_provider_refund_id: refund.id,
        p_amount: refund.amountInCents / 100, p_provider_event_id: eventId,
        p_completed_at: refund.dateCreated
      });
      if (reconciled.error) {
        await finish(false, "refund_reconciliation_failed");
        return reply({ ok: false }, 503);
      }
    }
    const completed = await finish(true);
    const ok = !completed.error && completed.data === true;
    return reply({ ok, review: false }, ok ? 200 : 503);
  } catch {
    await finish(false, "provider_unavailable");
    return reply({ ok: false }, 502);
  }
}
