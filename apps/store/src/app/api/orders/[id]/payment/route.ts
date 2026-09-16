import { NextResponse } from "next/server";
import { normalizeMercadoPagoStatus } from "@/lib/mercadopago-payment";
import { canContinueOrderPayment } from "@/lib/customer-account-presentation";
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
  if (orderResult.error) return reply({ message: "Não foi possível consultar o pedido." }, 503);
  if (!isUnknownRecord(orderResult.data)) return reply({ message: "Pedido não encontrado." }, 404);
  const paymentResult = readQueryResult(await db.from("payments")
    .select("id,provider_payment_id,status,status_detail,payment_method_summary,amount,currency,expires_at,pix_copy_paste,pix_qr_code_base64,boleto_url,digitable_line")
    .eq("order_id", id).eq("provider", "mercadopago").maybeSingle());
  if (paymentResult.error) return reply({ message: "Não foi possível consultar o pagamento." }, 503);
  if (!isUnknownRecord(paymentResult.data)) return reply({ message: "Pagamento não encontrado." }, 404);
  if (!readString(paymentResult.data, "payment_method_summary")) {
    return reply({ message: "Este checkout não possui uma intenção de pagamento." }, 404);
  }
  const order = orderResult.data;
  if (!canContinueOrderPayment(readString(order, "status"), readString(paymentResult.data, "status"),
    readString(paymentResult.data, "payment_method_summary"), readString(paymentResult.data, "status_detail"),
    readString(paymentResult.data, "expires_at"))) {
    const approved = readString(order, "payment_status") === "approved"
      && ["payment_approved", "processing", "picking", "ready_to_ship", "shipped", "delivered"].includes(readString(order, "status"));
    const items = approved ? readQueryResult(await db.from("order_items").select("variant_id").eq("order_id", id)) : null;
    const expired = readString(paymentResult.data, "status_detail") === "expired"
      || Date.parse(readString(paymentResult.data, "expires_at")) <= Date.now();
    return reply({ message: "Este pedido não aceita pagamento.", status: approved ? "approved"
      : expired ? "expired" : ["rejected", "cancelled", "refunded", "charged_back"].includes(readString(paymentResult.data, "status"))
        ? readString(paymentResult.data, "status") : "unavailable",
      orderCode: readString(order, "public_code"), orderStatus: readString(order, "status"),
      amountInCents: Math.round(readNumber(paymentResult.data, "amount") * 100),
      method: readString(paymentResult.data, "payment_method_summary"),
      variantIds: items && !items.error ? readRows(items.data).map((item) => readString(item, "variant_id")).filter(Boolean) : []
    }, 409);
  }
  const itemResult = readQueryResult(await db.from("order_items").select("variant_id").eq("order_id", id));
  const variantIds = itemResult.error ? [] : readRows(itemResult.data).map((item) => readString(item, "variant_id")).filter(Boolean);
  const payment = paymentResult.data;
  const expiresAt = Date.parse(readString(payment, "expires_at"));
  const paymentStatus = normalizeMercadoPagoStatus(readString(payment, "status"));
  const isLocallyExpired = ["pending", "rejected"].includes(paymentStatus)
    && Number.isFinite(expiresAt)
    && expiresAt <= Date.now();
  return reply({ orderId: id, orderCode: readString(order, "public_code"), orderStatus: readString(order, "status"), variantIds,
    status: readString(payment, "status_detail") === "expired" || isLocallyExpired ? "expired" : readString(payment, "status"),
    statusDetail: readString(payment, "status_detail"),
    method: readString(payment, "payment_method_summary"), amountInCents: Math.round(readNumber(payment, "amount") * 100),
    expiresAt: readString(payment, "expires_at"), pixCopyPaste: readString(payment, "pix_copy_paste"),
    pixQrCodeBase64: readString(payment, "pix_qr_code_base64"), boletoUrl: readString(payment, "boleto_url"),
    digitableLine: readString(payment, "digitable_line") });
}
