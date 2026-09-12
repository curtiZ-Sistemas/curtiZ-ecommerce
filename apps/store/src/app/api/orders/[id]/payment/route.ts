import { isMercadoPagoTestCredential, MercadoPagoTestPaymentProvider } from "@curtiz/integrations";
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
  if (!isUnknownRecord(orderResult.data)) return reply({ message: "Pedido não encontrado." }, 404);
  const paymentResult = readQueryResult(await db.from("payments")
    .select("id,provider_payment_id,status,status_detail,payment_method_summary,amount,currency,expires_at,pix_copy_paste,pix_qr_code_base64,boleto_url,digitable_line")
    .eq("order_id", id).eq("provider", "mercadopago").maybeSingle());
  if (!isUnknownRecord(paymentResult.data)) return reply({ message: "Pagamento não encontrado." }, 404);
  if (!readString(paymentResult.data, "payment_method_summary")) {
    return reply({ message: "Este checkout não possui uma intenção de pagamento." }, 404);
  }
  let order = orderResult.data;
  if (!canContinueOrderPayment(readString(order, "status"), readString(paymentResult.data, "status"),
    readString(paymentResult.data, "payment_method_summary"), readString(paymentResult.data, "status_detail"),
    readString(paymentResult.data, "expires_at"))) {
    const approved = readString(order, "payment_status") === "approved"
      && ["payment_approved", "processing", "picking", "ready_to_ship", "shipped", "delivered"].includes(readString(order, "status"));
    const items = approved ? readQueryResult(await db.from("order_items").select("variant_id").eq("order_id", id)) : null;
    return reply({ message: "Este pedido não aceita pagamento.", status: approved ? "approved" : "unavailable",
      variantIds: items && !items.error ? readRows(items.data).map((item) => readString(item, "variant_id")).filter(Boolean) : []
    }, 409);
  }
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
      const statusDetail = current.status === "expired" ? "expired" : current.statusDetail;
      await db.from("payments").update({ status_detail: statusDetail, expires_at: current.expiresAt,
        pix_copy_paste: current.pixCopyPaste || null, pix_qr_code_base64: current.pixQrCodeBase64 || null,
        boleto_url: current.boletoUrl || null, digitable_line: current.digitableLine || null, updated_at: new Date().toISOString() })
        .eq("id", readString(payment, "id"));
      const reconciliation = await db.rpc("finalize_mercadopago_payment", { p_provider_event_id: `poll-${current.id}-${current.status}`,
        p_provider_payment_id: current.id, p_external_reference: readString(order, "public_code"),
        p_amount: current.amountInCents / 100, p_currency: current.currency, p_status: status,
        p_paid_at: current.dateApproved,
        p_provider_fee: current.providerFeeInCents === null ? null : current.providerFeeInCents / 100,
        p_net_received_amount: current.netReceivedInCents === null ? null : current.netReceivedInCents / 100,
        p_payment_method: [current.paymentTypeId, current.paymentMethodId].filter(Boolean).join(":") || null,
        p_installments: current.installments,
        p_status_detail: statusDetail || null });
      if (reconciliation.error || reconciliation.data === "manual_review") throw new Error("payment_reconciliation_failed");
      for (const refund of current.refunds) {
        if (!["approved", "completed"].includes(refund.status)) continue;
        const reconciledRefund = await db.rpc("reconcile_mercadopago_provider_refund", {
          p_provider_payment_id: current.id, p_provider_refund_id: refund.id,
          p_amount: refund.amountInCents / 100,
          p_provider_event_id: `poll-${current.id}-${current.status}`,
          p_completed_at: refund.dateCreated
        });
        if (reconciledRefund.error) throw new Error("refund_reconciliation_failed");
      }
      payment = { ...payment, status, status_detail: statusDetail, expires_at: current.expiresAt,
        pix_copy_paste: current.pixCopyPaste, pix_qr_code_base64: current.pixQrCodeBase64,
        boleto_url: current.boletoUrl, digitable_line: current.digitableLine };
    } catch { /* Preserve the last trusted database state during provider outages. */ }
  }
  const expiresAt = Date.parse(readString(payment, "expires_at"));
  const paymentStatus = normalizeMercadoPagoStatus(readString(payment, "status"));
  const isLocallyExpired = ["pending", "rejected"].includes(paymentStatus)
    && Number.isFinite(expiresAt)
    && expiresAt <= Date.now();
  if (isLocallyExpired) {
    const expiration = readQueryResult(await db.rpc("expire_stale_mercadopago_order", {
      p_order_id: id
    }));
    if (!expiration.error && expiration.data === true) {
      payment = { ...payment, status: "cancelled", status_detail: "expired" };
      order = { ...order, status: "cancelled", payment_status: "cancelled" };
    }
  }
  return reply({ orderId: id, orderCode: readString(order, "public_code"), orderStatus: readString(order, "status"), variantIds,
    status: readString(payment, "status_detail") === "expired" || isLocallyExpired ? "expired" : readString(payment, "status"),
    statusDetail: readString(payment, "status_detail"),
    method: readString(payment, "payment_method_summary"), amountInCents: Math.round(readNumber(payment, "amount") * 100),
    expiresAt: readString(payment, "expires_at"), pixCopyPaste: readString(payment, "pix_copy_paste"),
    pixQrCodeBase64: readString(payment, "pix_qr_code_base64"), boletoUrl: readString(payment, "boleto_url"),
    digitableLine: readString(payment, "digitable_line") });
}
