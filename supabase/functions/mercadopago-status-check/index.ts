import { corsHeaders, json } from "../_shared/http.ts";
import { mercadoPagoRequest } from "../_shared/mercadopago.ts";
import { userClient } from "../_shared/supabase.ts";
import { integrationDisabledPayload, isMercadoPagoEnabled } from "../_shared/integrations.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isMercadoPagoEnabled()) return json(integrationDisabledPayload(), 503);
  const auth = userClient(request.headers.get("authorization") ?? "");
  const { data: claims } = await auth.auth.getClaims();
  if (!claims?.claims?.sub) return json({ error: "unauthorized" }, 401);
  const { payment_id } = (await request.json().catch(() => ({}))) as { payment_id?: string };
  if (!payment_id || !/^[A-Za-z0-9_-]{1,100}$/.test(payment_id)) {
    return json({ error: "invalid_payment" }, 400);
  }
  const { data: localPayment, error } = await auth
    .from("payments")
    .select("id,status,provider_payment_id")
    .eq("provider", "mercadopago")
    .eq("provider_payment_id", payment_id)
    .maybeSingle();
  if (error || !localPayment) return json({ error: "payment_not_found" }, 404);
  const response = await mercadoPagoRequest(`/v1/payments/${encodeURIComponent(payment_id)}`, {
    method: "GET"
  });
  if (!response.ok) return json({ error: "provider_unavailable" }, 502);
  const payment = await response.json();
  return json({ status: payment.status ?? localPayment.status });
});
