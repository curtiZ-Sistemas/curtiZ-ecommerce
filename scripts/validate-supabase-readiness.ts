export {};

async function main() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!rawUrl || !publishableKey) throw new Error("Configuração pública do Supabase ausente.");

  const endpoint = new URL("/rest/v1/rpc/cart_variant_stock_availability", rawUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      ...(!publishableKey.startsWith("sb_publishable_")
        ? { authorization: `Bearer ${publishableKey}` }
        : {}),
      "content-type": "application/json"
    },
    body: JSON.stringify({ p_variant_ids: ["00000000-0000-4000-8000-000000000001"] }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(
      `A migration/RPC obrigatória de disponibilidade não está pronta (HTTP ${response.status}).`
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!Array.isArray(body) || body.length !== 1) {
    throw new Error("A RPC de disponibilidade retornou um contrato inesperado.");
  }
  console.log("Supabase remoto e RPC obrigatória validados.");
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Não foi possível concluir o preflight Supabase."
  );
  process.exitCode = 1;
});
