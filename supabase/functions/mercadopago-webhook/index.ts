import { BodyLimitError, corsHeaders, json, readRawBody, requestId } from "../_shared/http.ts";

// Compatibility relay only. Processing is canonical in the Store route so the runtimes cannot diverge.
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const correlationId = requestId(request);
  const storeOrigin = Deno.env.get("NEXT_PUBLIC_STORE_URL")?.trim();
  let destination: URL;
  try {
    if (!storeOrigin) throw new Error();
    destination = new URL("/api/webhooks/mercadopago" + new URL(request.url).search, storeOrigin);
    if (destination.protocol !== "https:" || destination.username || destination.password ||
      destination.origin !== new URL(storeOrigin).origin) throw new Error();
  } catch {
    return json({ error: "canonical_webhook_not_configured", request_id: correlationId }, 503);
  }
  let body: Uint8Array;
  try { body = await readRawBody(request, 64 * 1024); }
  catch (error) { return json({ error: "invalid_request_body", request_id: correlationId }, error instanceof BodyLimitError ? error.status : 400); }
  try {
    const response = await fetch(destination, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      "x-request-id": request.headers.get("x-request-id") ?? "",
      "x-signature": request.headers.get("x-signature") ?? ""
    },
    body,
    signal: AbortSignal.timeout(15_000),
    redirect: "error"
  });
    return new Response(response.body, { status: response.status,
    headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return json({ error: "canonical_webhook_unavailable", request_id: correlationId }, 503);
  }
});
