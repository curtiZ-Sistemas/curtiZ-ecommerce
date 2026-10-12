import "server-only";
import { MelhorEnvioError } from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";

// Códigos internos, categóricos e estáveis. Nunca incluem valores de ambiente ou dados pessoais.
export type ShippingDiagnosticCode =
  | "store_supabase_auth_unavailable"
  | "shipping_rate_limit_unavailable"
  | "store_runtime_context_unavailable"
  | "shipping_provider_disabled"
  | "shipping_provider_unsupported"
  | "melhor_envio_not_configured"
  | "melhor_envio_configuration_invalid"
  | "store_service_database_unavailable"
  | "shipping_product_invalid"
  | "shipping_product_lookup_unavailable"
  | "melhor_envio_authentication"
  | "melhor_envio_validation"
  | "melhor_envio_rate_limited"
  | "melhor_envio_timeout"
  | "melhor_envio_provider_unavailable"
  | "shipping_quote_persistence_unavailable";

export type ShippingHealthState = "online" | "degraded" | "offline" | "not_configured";

export type ShippingQuoteStage = "products" | "provider" | "persistence";

/** Falha ao gravar as cotações; separada das falhas do provider. */
export class ShippingQuotePersistenceError extends Error {
  constructor(readonly databaseCode?: string) {
    super("shipping_quote_persistence_unavailable");
    this.name = "ShippingQuotePersistenceError";
  }
}

export type ShippingQuoteSupport = { requestId: string; supportCode: string };

export function createShippingQuoteSupport(): ShippingQuoteSupport {
  const requestId = crypto.randomUUID();
  return { requestId, supportCode: `FRT-${requestId.replaceAll("-", "").slice(0, 8).toUpperCase()}` };
}

export function classifyShippingQuoteFailure(stage: ShippingQuoteStage, error: unknown): ShippingDiagnosticCode {
  if (stage === "persistence" || error instanceof ShippingQuotePersistenceError) return "shipping_quote_persistence_unavailable";
  if (stage === "products") {
    if (error instanceof MelhorEnvioError && error.code === "validation") return "shipping_product_invalid";
    if (error instanceof MelhorEnvioError && error.code === "configuration") return "store_service_database_unavailable";
    return "shipping_product_lookup_unavailable";
  }
  if (!(error instanceof MelhorEnvioError)) return "melhor_envio_provider_unavailable";
  switch (error.code) {
    case "configuration": return "melhor_envio_not_configured";
    case "authentication": return "melhor_envio_authentication";
    case "validation": return "melhor_envio_validation";
    case "rate_limited": return "melhor_envio_rate_limited";
    case "timeout": return "melhor_envio_timeout";
    default: return "melhor_envio_provider_unavailable";
  }
}

const healthStateByCode: Readonly<Partial<Record<ShippingDiagnosticCode, ShippingHealthState>>> = {
  store_supabase_auth_unavailable: "degraded",
  shipping_rate_limit_unavailable: "degraded",
  store_runtime_context_unavailable: "offline",
  shipping_provider_disabled: "not_configured",
  shipping_provider_unsupported: "not_configured",
  melhor_envio_not_configured: "not_configured",
  melhor_envio_configuration_invalid: "not_configured",
  store_service_database_unavailable: "offline",
  shipping_product_lookup_unavailable: "degraded",
  melhor_envio_authentication: "offline",
  melhor_envio_validation: "degraded",
  melhor_envio_rate_limited: "degraded",
  melhor_envio_timeout: "degraded",
  melhor_envio_provider_unavailable: "degraded",
  shipping_quote_persistence_unavailable: "degraded"
  // shipping_product_invalid descreve o carrinho, não a saúde do frete da loja.
};

type DiagnosticDatabase = {
  from(table: string): {
    insert(values: Record<string, unknown>): PromiseLike<{ error: unknown }>;
    upsert(values: Record<string, unknown>, options: { onConflict: string }): PromiseLike<{ error: unknown }>;
  };
};

export type ShippingDiagnostic = {
  code: ShippingDiagnosticCode | null;
  support: ShippingQuoteSupport;
  environment: string;
  provider: string;
  missing?: readonly string[];
  invalid?: readonly string[];
  userId?: string | null;
  latencyMs?: number | null;
  httpStatus: number;
  failure?: unknown;
  stage?: ShippingQuoteStage;
  /** Identificador público (hash truncado) da chave ativa de tokens; nunca a chave. */
  tokenKeyId?: string;
};

const route = "/api/shipping/quote";
const configurationName = /^[A-Z][A-Z0-9_]{0,80}$/u;
const safeNames = (names: readonly string[] | undefined) => (names ?? []).filter((name) => configurationName.test(name));

const failureReasons = new Set([
  "credentials_missing", "credentials_read_failed", "credentials_write_failed", "token_decryption_failed", "token_key_unavailable",
  "refresh_token_expired", "oauth_rejected", "permission_denied", "refresh_lock_failed", "refresh_lock_timeout"
]);

function failureDetails(error: unknown): Record<string, string | number> {
  const details = error instanceof MelhorEnvioError ? error.diagnostic : {};
  const databaseCode = error instanceof ShippingQuotePersistenceError ? error.databaseCode : details.databaseCode;
  return {
    ...(details.reason && failureReasons.has(details.reason) ? { reason: details.reason } : {}),
    ...(Number.isInteger(details.upstreamStatus) && (details.upstreamStatus ?? 0) >= 100 && (details.upstreamStatus ?? 0) <= 599
      ? { upstreamStatus: details.upstreamStatus as number } : {}),
    ...(databaseCode && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/u.test(databaseCode) ? { databaseCode } : {})
  };
}

/**
 * Registra a última situação do frete da loja (integration_health) e um evento técnico pesquisável
 * pelo código de suporte. Se o banco não aceitar a gravação, emite um log estruturado sem dados sensíveis.
 * Nunca lança: a telemetria não pode alterar a resposta da cotação.
 */
export async function recordShippingDiagnostic(db: DiagnosticDatabase | null, diagnostic: ShippingDiagnostic): Promise<void> {
  const { code, support } = diagnostic;
  const metadata = {
    scope: "store_runtime",
    environment: diagnostic.environment,
    provider: diagnostic.provider,
    missing: safeNames(diagnostic.missing),
    invalid: safeNames(diagnostic.invalid),
    requestId: support.requestId,
    supportCode: support.supportCode,
    ...failureDetails(diagnostic.failure),
    ...(diagnostic.stage ? { stage: diagnostic.stage } : {}),
    ...(diagnostic.tokenKeyId && /^[0-9a-f]{12}$/u.test(diagnostic.tokenKeyId) ? { tokenKeyId: diagnostic.tokenKeyId } : {})
  };
  const healthState: ShippingHealthState | undefined = code === null ? "online" : healthStateByCode[code];
  const persisted = { health: healthState === undefined, event: code === null };

  if (db) {
    if (healthState !== undefined) {
      try {
        const result = await db.from("integration_health").upsert({
          provider: "melhorenvio_store",
          state: healthState,
          checked_at: new Date().toISOString(),
          latency_ms: diagnostic.latencyMs ?? null,
          error_summary: code,
          metadata_sanitized: metadata
        }, { onConflict: "provider" });
        persisted.health = !result.error;
      } catch {
        persisted.health = false;
      }
    }
    if (code !== null) {
      try {
        const result = await db.from("technical_events").insert({
          severity: diagnostic.httpStatus >= 500 ? "error" : "warning",
          source: "store.shipping_quote",
          event_type: code,
          message: `Cotação de frete não concluída · ${code} · suporte ${support.supportCode}`,
          context_sanitized: { ...metadata, httpStatus: diagnostic.httpStatus },
          request_id: support.requestId,
          user_id: diagnostic.userId ?? null,
          route,
          duration_ms: diagnostic.latencyMs ?? null
        });
        persisted.event = !result.error;
      } catch {
        persisted.event = false;
      }
    }
  }

  if (code !== null || !persisted.health || !persisted.event) {
    logServerEvent(code === null ? "warn" : "error", "shipping_quote_diagnostic", {
      requestId: support.requestId,
      supportCode: support.supportCode,
      code: code ?? "shipping_health_persistence_unavailable",
      provider: diagnostic.provider,
      environment: diagnostic.environment,
      missing: metadata.missing,
      invalid: metadata.invalid,
      ...failureDetails(diagnostic.failure),
      stage: diagnostic.stage,
      persisted
    });
  }
}
