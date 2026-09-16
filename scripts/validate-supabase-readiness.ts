export {};

const rpcHeaders = (publishableKey: string): Record<string, string> => ({
  apikey: publishableKey,
  ...(!publishableKey.startsWith("sb_publishable_")
    ? { authorization: `Bearer ${publishableKey}` }
    : {}),
  "content-type": "application/json"
});

async function main() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!rawUrl || !publishableKey) throw new Error("Configura\u00e7\u00e3o p\u00fablica do Supabase ausente.");

  const endpoint = new URL("/rest/v1/rpc/cart_variant_stock_availability", rawUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: rpcHeaders(publishableKey),
    body: JSON.stringify({ p_variant_ids: ["00000000-0000-4000-8000-000000000001"] }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`A migration/RPC obrigat\u00f3ria de disponibilidade n\u00e3o est\u00e1 pronta (HTTP ${response.status}).`);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!Array.isArray(body) || body.length !== 1) {
    throw new Error("A RPC de disponibilidade retornou um contrato inesperado.");
  }

  const rateLimitEndpoint = new URL("/rest/v1/rpc/auth_rate_limit_contract_version", rawUrl);
  const rateLimitResponse = await fetch(rateLimitEndpoint, {
    method: "POST",
    headers: rpcHeaders(publishableKey),
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!rateLimitResponse.ok) {
    throw new Error(`A migration/RPC obrigat\u00f3ria de rate limit n\u00e3o est\u00e1 pronta (HTTP ${rateLimitResponse.status}).`);
  }
  const rateLimitVersion: unknown = await rateLimitResponse.json().catch(() => null);
  if (rateLimitVersion !== 2) {
    throw new Error("A RPC de rate limit retornou uma vers\u00e3o de contrato inesperada.");
  }
  console.log("Supabase remoto e RPCs obrigat\u00f3rias validados.");
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "N\u00e3o foi poss\u00edvel concluir o preflight Supabase."
  );
  process.exitCode = 1;
});
