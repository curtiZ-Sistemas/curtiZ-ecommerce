import {
  getIntegrationConfig,
  getMelhorEnvioEnvironment,
  getMelhorEnvioReadiness,
  type MelhorEnvioReadiness
} from "@curtiz/config";
import { FIXED_SHIPPING_IN_CENTS, MelhorEnvioError } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { PrivateRequestError, readPrivateJson, requirePrivateRateLimit } from "@/lib/private-request";
import { configuredMelhorEnvioProvider, resolveShippingProducts } from "@/lib/melhor-envio-server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "@/lib/unknown-data";
import { getStoreRuntimeEnvironment, type RuntimeEnvironment } from "@/lib/runtime-environment";

const schema = z.object({
  postalCode: z.string().transform((value) => value.replace(/\D/gu, "")).pipe(z.string().regex(/^\d{8}$/)),
  lines: z.array(z.object({
    productId: z.string().uuid(), variantId: z.string().uuid(), quantity: z.number().int().min(1).max(10)
  })).min(1).max(50)
});

const noStore = { "cache-control": "private, no-store" };
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: noStore });
const storeHealthProvider = "melhorenvio_store";
type ShippingDatabase = NonNullable<ReturnType<typeof createServiceSupabaseClient>>;

function storeEnvironmentName(environment: RuntimeEnvironment): string {
  return getMelhorEnvioEnvironment(environment) ?? "unknown";
}

async function persistStoreShippingHealth(
  db: ShippingDatabase,
  state: "online" | "degraded" | "offline" | "not_configured",
  errorSummary: string | null,
  environment: RuntimeEnvironment,
  provider: string,
  readiness: MelhorEnvioReadiness,
  latencyMs: number | null = null
) {
  try {
    await db.from("integration_health").upsert({
      provider: storeHealthProvider,
      state,
      checked_at: new Date().toISOString(),
      latency_ms: latencyMs,
      error_summary: errorSummary,
      metadata_sanitized: {
        scope: "store_runtime",
        environment: storeEnvironmentName(environment),
        provider,
        missing: readiness.missing,
        invalid: readiness.invalid
      }
    }, { onConflict: "provider" });
  } catch {
    // A falha na telemetria não pode mudar a resposta do cálculo de frete.
  }
}

function providerErrorSummary(error: unknown): string {
  if (!(error instanceof MelhorEnvioError)) return "melhor_envio_provider_unavailable";
  switch (error.code) {
    case "configuration": return "melhor_envio_not_configured";
    case "authentication": return "melhor_envio_authentication";
    case "validation": return "melhor_envio_validation";
    case "timeout": return "melhor_envio_timeout";
    default: return "melhor_envio_provider_unavailable";
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return reply({ ok: false, code: "ORIGIN_NOT_ALLOWED", message: "Origem não permitida." }, 403);
  const auth = await createServerSupabaseClient();
  if (!auth) return reply({ ok: false, code: "SHIPPING_UNAVAILABLE", message: "O frete está temporariamente indisponível." }, 503);
  const userResult = await auth.auth.getUser();
  const user = userResult.data.user;
  if (!user || userResult.error) return reply({ ok: false, code: "AUTHENTICATION_REQUIRED", message: "Entre na sua conta para calcular o frete." }, 401);
  try { await requirePrivateRateLimit(auth, "shipping_quote"); }
  catch (error) {
    const status = error instanceof PrivateRequestError ? error.status : 503;
    return reply({ ok: false, code: status === 429 ? "RATE_LIMITED" : "SHIPPING_UNAVAILABLE",
      message: status === 429 ? "Aguarde antes de calcular novamente." : "Não foi possível calcular o frete agora." }, status);
  }

  let environment: RuntimeEnvironment;
  try { environment = getStoreRuntimeEnvironment(); }
  catch {
    return reply({ ok: false, code: "SHIPPING_UNAVAILABLE", message: "O frete está temporariamente indisponível. Tente novamente." }, 503);
  }
  const config = getIntegrationConfig(environment);
  const readiness = getMelhorEnvioReadiness(environment);
  if (!config.shipping.enabled || !["melhorenvio", "fixed"].includes(config.shipping.provider)) {
    const db = createServiceSupabaseClient();
    if (db) {
      const melhorEnvioSelected = config.shipping.provider === "melhorenvio";
      await persistStoreShippingHealth(db, "not_configured",
        melhorEnvioSelected ? "melhor_envio_not_configured"
          : config.shipping.provider === "disabled" ? "shipping_provider_disabled" : "shipping_provider_unsupported",
        environment, config.shipping.provider,
        melhorEnvioSelected ? readiness : { configured: false, missing: [], invalid: [] });
    }
    return reply({ ok: false, code: "SHIPPING_UNAVAILABLE", message: "O frete está temporariamente indisponível. Tente novamente." }, 503);
  }

  let input: unknown;
  try { input = await readPrivateJson(request, 24 * 1024); }
  catch (error) { return reply({ ok: false, code: error instanceof PrivateRequestError && error.status === 413 ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST",
    message: "Revise o CEP e os itens." }, error instanceof PrivateRequestError ? error.status : 400); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return reply({ ok: false, code: "INVALID_REQUEST", message: "Revise o CEP e os itens." }, 400);
  if (config.shipping.provider === "fixed") return reply({ ok: true, quotes: [{
    id: "fixed", serviceId: "standard", service: "Entrega padrão", carrier: "curti Z",
    amountInCents: FIXED_SHIPPING_IN_CENTS, estimatedDays: null, expiresAt: null
  }] });

  const db = createServiceSupabaseClient();
  if (!db) return reply({ ok: false, code: "SHIPPING_UNAVAILABLE", message: "O frete está temporariamente indisponível." }, 503);
  const started = Date.now();
  try {
    const resolved = await resolveShippingProducts(parsed.data.lines, db);
    const provider = configuredMelhorEnvioProvider(environment, db);
    const quotes = await provider.quote({
      originPostalCode: environment.MELHOR_ENVIO_ORIGIN_POSTAL_CODE?.trim() ?? "",
      destinationPostalCode: parsed.data.postalCode,
      products: resolved.products
    });
    await persistStoreShippingHealth(db, "online", null, environment, "melhorenvio", readiness, Date.now() - started);
    if (quotes.length === 0) return reply({ ok: true, quotes: [], message: "Nenhum serviço atende este CEP e estes itens." });
    const rows = quotes.map((quote) => ({
      customer_id: user.id, provider: quote.provider, service_id: quote.serviceId, service: quote.service,
      carrier: quote.carrier, amount: quote.amountInCents / 100, cost: quote.costInCents / 100,
      estimated_days: quote.estimatedDays, packages: quote.packages,
      destination_postal_code: parsed.data.postalCode, cart_fingerprint: resolved.fingerprint,
      provider_environment: storeEnvironmentName(environment),
      provider_payload: { packages: quote.packages }, expires_at: quote.expiresAt
    }));
    const insertion = readQueryResult(await db.from("shipping_quotes").insert(rows)
      .select("id,service_id,service,carrier,amount,cost,estimated_days,expires_at"));
    if (insertion.error || !Array.isArray(insertion.data)) throw new MelhorEnvioError("provider_unavailable", 503, true);
    return reply({ ok: true, quotes: insertion.data.filter(isUnknownRecord).map((row) => ({
      id: readString(row, "id"), serviceId: readString(row, "service_id"), service: readString(row, "service"),
      carrier: readString(row, "carrier"), amountInCents: Math.round(readNumber(row, "amount") * 100),
      estimatedDays: readNumber(row, "estimated_days"), expiresAt: readString(row, "expires_at")
    })) });
  } catch (error) {
    const errorSummary = providerErrorSummary(error);
    await persistStoreShippingHealth(db, errorSummary === "melhor_envio_authentication" ? "offline" : "degraded",
      errorSummary, environment, "melhorenvio", readiness, Date.now() - started);
    const status = error instanceof MelhorEnvioError ? error.httpStatus : 503;
    const unavailable = status >= 500 || error instanceof MelhorEnvioError && ["authentication", "rate_limited"].includes(error.code);
    return reply({ ok: false, code: unavailable ? "SHIPPING_UNAVAILABLE" : "SHIPPING_INPUT_INVALID",
      message: unavailable ? "Não foi possível calcular o frete agora. Tente novamente." : "Revise o CEP e os itens do carrinho." }, unavailable ? 503 : status);
  }
}
