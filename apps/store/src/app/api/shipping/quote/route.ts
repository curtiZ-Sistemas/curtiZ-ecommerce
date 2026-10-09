import {
  getIntegrationConfig,
  getMelhorEnvioEnvironment,
  getMelhorEnvioReadiness
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
import {
  classifyShippingQuoteFailure,
  createShippingQuoteSupport,
  recordShippingDiagnostic,
  ShippingQuotePersistenceError,
  type ShippingDiagnosticCode,
  type ShippingQuoteStage
} from "@/lib/shipping-quote-diagnostics";

const schema = z.object({
  postalCode: z.string().transform((value) => value.replace(/\D/gu, "")).pipe(z.string().regex(/^\d{8}$/)),
  lines: z.array(z.object({
    productId: z.string().uuid(), variantId: z.string().uuid(), quantity: z.number().int().min(1).max(10)
  })).min(1).max(50)
});

const unavailableMessage = "O frete está temporariamente indisponível. Tente novamente.";
const quoteFailedMessage = "Não foi possível calcular o frete agora. Tente novamente.";

function storeEnvironmentName(environment: RuntimeEnvironment | null): string {
  return environment ? getMelhorEnvioEnvironment(environment) ?? "unknown" : "unknown";
}

// O código de suporte é curto, aleatório e não sensível; o painel técnico o localiza nos eventos.
function withSupport(message: string, supportCode: string) {
  return `${message} Código de suporte: ${supportCode}.`;
}

export async function POST(request: NextRequest) {
  const support = createShippingQuoteSupport();
  const headers = { "cache-control": "private, no-store", "x-support-code": support.supportCode };
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers });
  const fail = (status: number, code: string, message: string) =>
    reply({ ok: false, code, message: withSupport(message, support.supportCode), supportCode: support.supportCode }, status);
  let userId: string | null = null;
  let environment: RuntimeEnvironment | null = null;
  const diagnose = async (
    code: ShippingDiagnosticCode,
    httpStatus: number,
    details: { provider?: string; missing?: readonly string[]; invalid?: readonly string[]; latencyMs?: number | null;
      failure?: unknown; stage?: ShippingQuoteStage } = {},
    db?: ReturnType<typeof createServiceSupabaseClient>
  ) => {
    let database = db;
    if (database === undefined) {
      try { database = createServiceSupabaseClient(); } catch { database = null; }
    }
    await recordShippingDiagnostic(database, {
      code, support, httpStatus, userId,
      environment: storeEnvironmentName(environment),
      provider: details.provider ?? "unknown",
      missing: details.missing, invalid: details.invalid, latencyMs: details.latencyMs ?? null,
      failure: details.failure, stage: details.stage
    });
  };

  if (!isAllowedRequestOrigin(request)) return reply({ ok: false, code: "ORIGIN_NOT_ALLOWED", message: "Origem não permitida." }, 403);
  const auth = await createServerSupabaseClient();
  if (!auth) {
    await diagnose("store_supabase_auth_unavailable", 503);
    return fail(503, "SHIPPING_UNAVAILABLE", unavailableMessage);
  }
  const userResult = await auth.auth.getUser();
  const user = userResult.data.user;
  if (!user || userResult.error) return reply({ ok: false, code: "AUTHENTICATION_REQUIRED", message: "Entre na sua conta para calcular o frete." }, 401);
  userId = user.id;
  try { await requirePrivateRateLimit(auth, "shipping_quote"); }
  catch (error) {
    const status = error instanceof PrivateRequestError ? error.status : 503;
    if (status === 429) return reply({ ok: false, code: "RATE_LIMITED", message: "Aguarde antes de calcular novamente." }, 429);
    await diagnose("shipping_rate_limit_unavailable", 503);
    return fail(503, "SHIPPING_UNAVAILABLE", quoteFailedMessage);
  }

  try { environment = getStoreRuntimeEnvironment(); }
  catch {
    await diagnose("store_runtime_context_unavailable", 503);
    return fail(503, "SHIPPING_UNAVAILABLE", unavailableMessage);
  }
  const config = getIntegrationConfig(environment);
  const readiness = getMelhorEnvioReadiness(environment);
  if (!config.shipping.enabled || !["melhorenvio", "fixed"].includes(config.shipping.provider)) {
    const provider = config.shipping.provider;
    if (provider === "melhorenvio") {
      await diagnose(readiness.missing.length ? "melhor_envio_not_configured" : "melhor_envio_configuration_invalid", 503,
        { provider, missing: readiness.missing, invalid: readiness.invalid });
    } else {
      await diagnose(provider === "disabled" ? "shipping_provider_disabled" : "shipping_provider_unsupported", 503, { provider });
    }
    return fail(503, "SHIPPING_UNAVAILABLE", unavailableMessage);
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
  if (!db) {
    await diagnose("store_service_database_unavailable", 503, { provider: "melhorenvio" }, null);
    return fail(503, "SHIPPING_UNAVAILABLE", unavailableMessage);
  }
  const runtime = environment;
  const started = Date.now();
  let stage: ShippingQuoteStage = "products";
  try {
    const resolved = await resolveShippingProducts(parsed.data.lines, db);
    stage = "provider";
    const provider = configuredMelhorEnvioProvider(runtime, db);
    const quotes = await provider.quote({
      originPostalCode: runtime.MELHOR_ENVIO_ORIGIN_POSTAL_CODE?.trim() ?? "",
      destinationPostalCode: parsed.data.postalCode,
      products: resolved.products
    });
    stage = "persistence";
    if (quotes.length === 0) {
      await recordShippingDiagnostic(db, { code: null, support, httpStatus: 200, userId,
        environment: storeEnvironmentName(runtime), provider: "melhorenvio", latencyMs: Date.now() - started });
      return reply({ ok: true, quotes: [], message: "Nenhum serviço atende este CEP e estes itens." });
    }
    const rows = quotes.map((quote) => ({
      customer_id: user.id, provider: quote.provider, service_id: quote.serviceId, service: quote.service,
      carrier: quote.carrier, amount: quote.amountInCents / 100, cost: quote.costInCents / 100,
      estimated_days: quote.estimatedDays, packages: quote.packages,
      destination_postal_code: parsed.data.postalCode, cart_fingerprint: resolved.fingerprint,
      provider_environment: storeEnvironmentName(runtime),
      provider_payload: { packages: quote.packages }, expires_at: quote.expiresAt
    }));
    const insertion = readQueryResult(await db.from("shipping_quotes").insert(rows)
      .select("id,service_id,service,carrier,amount,cost,estimated_days,expires_at"));
    if (insertion.error || !Array.isArray(insertion.data) || insertion.data.length !== quotes.length
      || insertion.data.some((row) => !isUnknownRecord(row) || !readString(row, "id"))) {
      throw new ShippingQuotePersistenceError(isUnknownRecord(insertion.error) ? readString(insertion.error, "code") : undefined);
    }
    await recordShippingDiagnostic(db, { code: null, support, httpStatus: 200, userId,
      environment: storeEnvironmentName(runtime), provider: "melhorenvio", latencyMs: Date.now() - started });
    return reply({ ok: true, quotes: insertion.data.filter(isUnknownRecord).map((row) => ({
      id: readString(row, "id"), serviceId: readString(row, "service_id"), service: readString(row, "service"),
      carrier: readString(row, "carrier"), amountInCents: Math.round(readNumber(row, "amount") * 100),
      estimatedDays: readNumber(row, "estimated_days"), expiresAt: readString(row, "expires_at")
    })) });
  } catch (error) {
    const code = classifyShippingQuoteFailure(stage, error);
    const inputProblem = code === "shipping_product_invalid"
      || code === "melhor_envio_validation" && error instanceof MelhorEnvioError && error.httpStatus < 500;
    const status = inputProblem && error instanceof MelhorEnvioError ? error.httpStatus : 503;
    await diagnose(code, status, { provider: "melhorenvio", latencyMs: Date.now() - started, failure: error, stage }, db);
    if (code === "shipping_product_invalid") return fail(status, "SHIPPING_ITEMS_INVALID", "Revise os itens do carrinho.");
    if (inputProblem) return fail(status, "SHIPPING_INPUT_INVALID", "Revise o CEP e os itens do carrinho.");
    return fail(503, "SHIPPING_UNAVAILABLE", quoteFailedMessage);
  }
}
