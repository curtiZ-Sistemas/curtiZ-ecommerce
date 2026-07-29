import { corsHeaders, json } from "../_shared/http.ts";
import { mercadoPagoRequest } from "../_shared/mercadopago.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { payment_id } = (await request.json()) as { payment_id?: string };
  if (!payment_id) return json({ error: "invalid_payment" }, 400);
  const response = await mercadoPagoRequest(`/v1/payments/${encodeURIComponent(payment_id)}`, { method: "GET" });
  if (!response.ok) return json({ error: "provider_unavailable" }, 502);
  const payment = await response.json();
  return json({ status: payment.status, external_reference: payment.external_reference });
});
