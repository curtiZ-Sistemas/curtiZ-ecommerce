import { corsHeaders, json } from "../_shared/http.ts";
import { mercadoPagoRequest } from "../_shared/mercadopago.ts";
import { userClient } from "../_shared/supabase.ts";
import { integrationDisabledPayload, isMercadoPagoEnabled } from "../_shared/integrations.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isMercadoPagoEnabled()) return json(integrationDisabledPayload(), 503);
  const auth = userClient(request.headers.get("authorization") ?? "");
  const { data: allowed } = await auth.rpc("has_permission", { permission_code: "returns.refund" });
  if (!allowed) return json({ error: "forbidden" }, 403);
  const { payment_id, amount } = (await request.json()) as { payment_id?: string; amount?: number };
  if (!payment_id || !amount || amount <= 0) return json({ error: "invalid_refund" }, 400);
  const response = await mercadoPagoRequest(
    `/v1/payments/${encodeURIComponent(payment_id)}/refunds`,
    { method: "POST", body: JSON.stringify({ amount }) },
    crypto.randomUUID()
  );
  if (!response.ok) return json({ error: "refund_failed" }, 502);
  return json({ ok: true, refund: await response.json() });
});
