export {};

async function main() {
  const baseArgument =
    process.argv.slice(2).find((argument) => argument !== "--") ?? process.env.STOREFRONT_SMOKE_URL;
  if (!baseArgument) throw new Error("Informe a URL da loja para o smoke test.");

  const baseUrl = new URL(baseArgument);
  if (baseUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
    throw new Error("O smoke test remoto exige HTTPS.");
  }

  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      redirect: "follow",
      signal: AbortSignal.timeout(15_000)
    });
    return response;
  };

  const requireSuccess = async (name: string, path: string, init?: RequestInit) => {
    const response = await request(path, init);
    if (!response.ok) throw new Error(`${name} falhou com HTTP ${response.status}.`);
    console.log(`${name}: HTTP ${response.status}`);
    return response;
  };

  await requireSuccess("homepage", "/");
  const catalog = await requireSuccess("catálogo", "/api/catalog?compacto=1&pageSize=1");
  const catalogBody: unknown = await catalog.json().catch(() => null);
  if (
    !catalogBody ||
    typeof catalogBody !== "object" ||
    !("products" in catalogBody) ||
    !Array.isArray(catalogBody.products)
  ) {
    throw new Error("O catálogo não retornou o contrato JSON esperado.");
  }

  const integrations = await requireSuccess("configuração pública", "/api/integrations/status");
  const integrationsBody: unknown = await integrations.json().catch(() => null);
  if (
    !integrationsBody ||
    typeof integrationsBody !== "object" ||
    [
      "checkoutEnabled",
      "paymentEnabled",
      "shippingEnabled",
      "emailEnabled",
      "turnstileEnabled"
    ].some((key) => typeof (integrationsBody as Record<string, unknown>)[key] !== "boolean")
  ) {
    throw new Error("A configuração pública necessária está incompleta.");
  }

  await requireSuccess("API essencial", "/api/version");
  const availability = await requireSuccess("Supabase/disponibilidade", "/api/cart/availability", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl.origin
    },
    body: JSON.stringify({ variantIds: ["00000000-0000-4000-8000-000000000001"] })
  });
  const availabilityBody: unknown = await availability.json().catch(() => null);
  const items =
    availabilityBody && typeof availabilityBody === "object" && "items" in availabilityBody
      ? availabilityBody.items
      : null;
  if (!Array.isArray(items) || items.length !== 1) {
    throw new Error("A disponibilidade não retornou o contrato JSON esperado.");
  }

  console.log("Smoke test da loja concluído sem iniciar compra ou cobrança.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Não foi possível concluir o smoke test.");
  process.exitCode = 1;
});
