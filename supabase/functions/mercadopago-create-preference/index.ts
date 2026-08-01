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

  const idempotencyKey = crypto.randomUUID();
  const response = await mercadoPagoRequest(
    "/checkout/preferences",
    {
      method: "POST",
      body: JSON.stringify({
        items: order.order_items.map((item) => ({
          title: item.product_name_snapshot,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          currency_id: order.currency
        })),
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
    idempotencyKey
  );
  if (!response.ok) return json({ error: "provider_unavailable", request_id: correlationId }, 502);
  const preference = await response.json();
  return json({
    preference_id: preference.id,
    redirect_url: preference.init_point,
    request_id: correlationId
  });
});
