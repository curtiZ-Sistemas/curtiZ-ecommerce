import { corsHeaders, json, readJson } from "../_shared/http.ts";
import { mercadoPagoRequest } from "../_shared/mercadopago.ts";
import { userClient } from "../_shared/supabase.ts";
import { integrationDisabledPayload, isMercadoPagoEnabled } from "../_shared/integrations.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isMercadoPagoEnabled()) return json(integrationDisabledPayload(), 503);
  const auth = userClient(request.headers.get("authorization") ?? "");
  const { data: session, error: sessionError } = await auth.auth.getUser();
  if (sessionError || !session.user) return json({ error: "unauthorized" }, 401);
  const body = await readJson(request,2048);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_payment" },400);
  const { payment_id } = body as { payment_id?: string };
  if (typeof payment_id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(payment_id)) {
    return json({ error: "invalid_payment" }, 400);
  }
  const { data: localPayment, error } = await auth
    .from("payments")
    .select("id,order_id,status,provider_payment_id")
    .eq("provider", "mercadopago")
    .eq("provider_payment_id", payment_id)
    .maybeSingle();
  if (error || !localPayment) return json({ error: "payment_not_found" }, 404);
  const budget = await auth.rpc("claim_payment_reconciliation", { p_order_id: localPayment.order_id });
  if (budget.error || typeof budget.data !== "boolean") return json({ error: "reconciliation_unavailable" },503);
  if (!budget.data) return json({ error: "rate_limited" },429);
  const response = await mercadoPagoRequest(`/v1/payments/${encodeURIComponent(payment_id)}`, {
    method: "GET"
  });
  if (!response.ok) return json({ error: "provider_unavailable" }, 502);
  const payment = await response.json();
  return json({ status: payment.status ?? localPayment.status });
});
