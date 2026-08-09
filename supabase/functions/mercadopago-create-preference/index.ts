import { corsHeaders, json, requestId } from "../_shared/http.ts";
import { mercadoPagoRequest } from "../_shared/mercadopago.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { integrationDisabledPayload, isMercadoPagoEnabled } from "../_shared/integrations.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const correlationId = requestId(request);
  if (!isMercadoPagoEnabled()) return json(integrationDisabledPayload(correlationId), 503);
  const authorization = request.headers.get("authorization") ?? "";
  const authClient = userClient(authorization);
  const { data: claims } = await authClient.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return json({ error: "unauthorized", request_id: correlationId }, 401);

  const { order_id } = (await request.json()) as { order_id?: string };
  if (!order_id) return json({ error: "invalid_order", request_id: correlationId }, 400);

  const db = serviceClient();
  const { data: order, error } = await db
    .from("orders")
    .select(
      "id, public_code, customer_id, customer_email_snapshot, currency, grand_total, status, order_items(product_name_snapshot, quantity, unit_price)"
    )
    .eq("id", order_id)
    .single();
  if (error || !order || order.customer_id !== userId || order.status !== "pending_payment") {
    return json({ error: "order_not_available", request_id: correlationId }, 409);
  }

  const { data: existingPayment } = await db
    .from("payments")
    .select("id,status,provider_preference_id,provider_redirect_url")
    .eq("order_id", order.id)
    .eq("provider", "mercadopago")
    .maybeSingle();
  if (existingPayment?.provider_preference_id && existingPayment.provider_redirect_url) {
    return json({
      preference_id: existingPayment.provider_preference_id,
      redirect_url: existingPayment.provider_redirect_url,
      request_id: correlationId,
      reused: true
    });
  }
  if (existingPayment && !["pending", "in_review"].includes(existingPayment.status)) {
    return json({ error: "payment_not_available", request_id: correlationId }, 409);
  }
  let paymentId = existingPayment?.id ?? crypto.randomUUID();
  if (!existingPayment) {
    const { error: paymentError } = await db.from("payments").insert({
      id: paymentId,
      order_id: order.id,
      provider: "mercadopago",
      external_reference: order.public_code,
      status: "pending",
      amount: order.grand_total,
      currency: order.currency
    });
    if (paymentError && paymentError.code !== "23505") {
      return json({ error: "payment_unavailable", request_id: correlationId }, 503);
    }
    if (paymentError?.code === "23505") {
      const { data: concurrentPayment, error: concurrentError } = await db
        .from("payments")
        .select("id,status,provider_preference_id,provider_redirect_url")
        .eq("order_id", order.id)
        .eq("provider", "mercadopago")
        .single();
      if (concurrentError || !concurrentPayment) {
        return json({ error: "payment_unavailable", request_id: correlationId }, 503);
      }
      if (concurrentPayment.provider_preference_id && concurrentPayment.provider_redirect_url) {
        return json({
          preference_id: concurrentPayment.provider_preference_id,
          redirect_url: concurrentPayment.provider_redirect_url,
          request_id: correlationId,
          reused: true
        });
      }
      if (!["pending", "in_review"].includes(concurrentPayment.status)) {
        return json({ error: "payment_not_available", request_id: correlationId }, 409);
      }
      paymentId = concurrentPayment.id;
    }
  }

  const response = await mercadoPagoRequest(
    "/checkout/preferences",
    {
      method: "POST",
      body: JSON.stringify({
        items: [{
          title: `Pedido ${order.public_code}`,
          quantity: 1,
          unit_price: Number(order.grand_total),
          currency_id: order.currency
        }],
        payer: { email: order.customer_email_snapshot },
        external_reference: order.public_code,
        notification_url: Deno.env.get("MERCADO_PAGO_NOTIFICATION_URL"),
        back_urls: {
          success: Deno.env.get("MERCADO_PAGO_SUCCESS_URL"),
          pending: Deno.env.get("MERCADO_PAGO_PENDING_URL"),
          failure: Deno.env.get("MERCADO_PAGO_FAILURE_URL")
        },
        auto_return: "approved"
      })
    },
    order.id
  );
  if (!response.ok) return json({ error: "provider_unavailable", request_id: correlationId }, 502);
  const preference = await response.json();
  if (
    typeof preference.id !== "string" ||
    typeof preference.init_point !== "string" ||
    !preference.init_point.startsWith("https://")
  ) return json({ error: "invalid_provider_response", request_id: correlationId }, 502);
  const { error: updateError } = await db
    .from("payments")
    .update({
      provider_preference_id: preference.id,
      provider_redirect_url: preference.init_point,
      updated_at: new Date().toISOString()
    })
    .eq("id", paymentId);
  if (updateError) return json({ error: "payment_reconciliation_failed", request_id: correlationId }, 503);
  return json({
    preference_id: preference.id,
    redirect_url: preference.init_point,
    request_id: correlationId
  });
});
