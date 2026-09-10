import { isMercadoPagoTestCredential, MercadoPagoTestPaymentProvider } from "@curtiz/integrations";
import { NextResponse } from "next/server";
import { normalizeMercadoPagoStatus } from "@/lib/mercadopago-payment";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readRows, readString } from "@/lib/unknown-data";

const headers = { "cache-control": "private, no-store" };
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await createServerSupabaseClient();
  const user = auth ? (await auth.auth.getUser()).data.user : null;
  if (!user) return reply({ message: "Entre na sua conta para continuar." }, 401);
  const db = createServiceSupabaseClient();
  if (!db) return reply({ message: "Não foi possível consultar o pagamento agora." }, 503);
  const orderResult = readQueryResult(await db.from("orders")
    .select("id,public_code,customer_id,status,payment_status,grand_total,currency")
    .eq("id", id).eq("customer_id", user.id).maybeSingle());
  if (!isUnknownRecord(orderResult.data)) return reply({ message: "Pedido não encontrado." }, 404);
  const paymentResult = readQueryResult(await db.from("payments")
    .select("id,provider_payment_id,status,status_detail,payment_method_summary,amount,currency,expires_at,pix_copy_paste,pix_qr_code_base64,boleto_url,digitable_line")
    .eq("order_id", id).eq("provider", "mercadopago").maybeSingle());
  if (!isUnknownRecord(paymentResult.data)) return reply({ message: "Pagamento não encontrado." }, 404);
  const order = orderResult.data;
  const itemResult = readQueryResult(await db.from("order_items").select("variant_id").eq("order_id", id));
  const variantIds = itemResult.error ? [] : readRows(itemResult.data).map((item) => readString(item, "variant_id")).filter(Boolean);
  let payment = paymentResult.data;
  const providerId = readString(payment, "provider_payment_id");
  const localStatus = normalizeMercadoPagoStatus(readString(payment, "status"));
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
  if (providerId && !["approved", "rejected", "cancelled", "refunded", "charged_back"].includes(localStatus)
    && isMercadoPagoTestCredential(accessToken)) {
    try {
      const current = await new MercadoPagoTestPaymentProvider(accessToken).getPayment(providerId);
      if (current.externalReference !== readString(order, "public_code")
        || current.amountInCents !== Math.round(readNumber(order, "grand_total") * 100)
        || current.currency !== readString(order, "currency")) throw new Error("payment_mismatch");
      const status = normalizeMercadoPagoStatus(current.status);
      await db.from("payments").update({ status_detail: current.statusDetail, expires_at: current.expiresAt,
        pix_copy_paste: current.pixCopyPaste || null, pix_qr_code_base64: current.pixQrCodeBase64 || null,
        boleto_url: current.boletoUrl || null, digitable_line: current.digitableLine || null, updated_at: new Date().toISOString() })
        .eq("id", readString(payment, "id"));
      await db.rpc("finalize_mercadopago_payment", { p_provider_event_id: `poll-${current.id}-${current.status}`,
        p_provider_payment_id: current.id, p_external_reference: readString(order, "public_code"),
        p_amount: current.amountInCents / 100, p_currency: current.currency, p_status: status,
        p_paid_at: current.dateApproved });
      payment = { ...payment, status, status_detail: current.statusDetail, expires_at: current.expiresAt,
        pix_copy_paste: current.pixCopyPaste, pix_qr_code_base64: current.pixQrCodeBase64,
        boleto_url: current.boletoUrl, digitable_line: current.digitableLine };
    } catch { /* Preserve the last trusted database state during provider outages. */ }
  }
  return reply({ orderId: id, orderCode: readString(order, "public_code"), orderStatus: readString(order, "status"), variantIds,
    status: readString(payment, "status"), statusDetail: readString(payment, "status_detail"),
    method: readString(payment, "payment_method_summary"), amountInCents: Math.round(readNumber(payment, "amount") * 100),
    expiresAt: readString(payment, "expires_at"), pixCopyPaste: readString(payment, "pix_copy_paste"),
    pixQrCodeBase64: readString(payment, "pix_qr_code_base64"), boletoUrl: readString(payment, "boleto_url"),
    digitableLine: readString(payment, "digitable_line") });
}
