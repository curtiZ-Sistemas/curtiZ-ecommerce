import { createHmac, timingSafeEqual } from "node:crypto";
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
  const body: unknown = await request.json().catch(() => null);
  const bodyId = body && typeof body === "object" && "data" in body && body.data && typeof body.data === "object" && "id" in body.data
    ? String(body.data.id) : "";
  const dataId = url.searchParams.get("data.id") ?? bodyId;
  if (!dataId || !signed(request, dataId, secret)) return NextResponse.json({ ok: false }, { status: 401 });
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });
  try {
    const payment = await new MercadoPagoTestPaymentProvider(accessToken).getPayment(dataId);
    const result = await db.rpc("finalize_mercadopago_payment", { p_provider_event_id: `webhook-${dataId}-${payment.status}`,
      p_provider_payment_id: payment.id, p_external_reference: payment.externalReference,
      p_amount: payment.amountInCents / 100, p_currency: payment.currency,
      p_status: normalizeMercadoPagoStatus(payment.status), p_paid_at: payment.dateApproved });
    return NextResponse.json({ ok: !result.error }, { status: result.error ? 503 : 200 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
