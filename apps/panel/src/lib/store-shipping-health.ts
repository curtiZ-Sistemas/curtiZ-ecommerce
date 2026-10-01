type ServiceState = "online" | "degraded" | "offline" | "configured" | "not_configured" | "mock" | "unavailable";
export type StoreShippingService = {
  name: string;
  state: ServiceState;
  detail: string;
  checkedAt?: string | null;
  latencyMs?: number | null;
};

// Códigos gravados por /api/shipping/quote no Worker da loja (apps/store/src/lib/shipping-quote-diagnostics.ts).
const reasonLabels: Readonly<Record<string, string>> = {
  shipping_provider_disabled: "Frete desabilitado na configuração efetiva da loja",
  shipping_provider_unsupported: "O provider de frete selecionado não tem cotação disponível na loja",
  melhor_envio_not_configured: "Configuração do Melhor Envio incompleta na loja",
  melhor_envio_configuration_invalid: "Configuração do Melhor Envio com valor inválido na loja",
  store_runtime_context_unavailable: "Runtime do Cloudflare indisponível na loja",
  store_supabase_auth_unavailable: "Sessão do Supabase indisponível na loja",
  store_service_database_unavailable: "Acesso de serviço ao banco indisponível na loja",
  shipping_rate_limit_unavailable: "Limitador de requisições (RPC) indisponível na loja",
  shipping_product_lookup_unavailable: "Consulta dos produtos do carrinho falhou na loja",
  shipping_quote_persistence_unavailable: "Cotação obtida, mas não foi gravada em shipping_quotes",
  melhor_envio_authentication: "Autenticação do Melhor Envio falhou na loja (OAuth/token)",
  melhor_envio_provider_unavailable: "Provedor de frete indisponível na loja",
  melhor_envio_validation: "O Melhor Envio rejeitou os dados da cotação",
  melhor_envio_rate_limited: "O Melhor Envio limitou as requisições da loja",
  melhor_envio_timeout: "Tempo limite excedido ao consultar o Melhor Envio"
};

const supportCodePattern = /^FRT-[0-9A-F]{8}$/u;

const safeConfigurationCodes = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string =>
    typeof item === "string" && /^MELHOR_ENVIO_[A-Z0-9_]+$/u.test(item)))]
  : [];

export function getStoreShippingService(value: unknown): StoreShippingService {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!row) return {
    name: "Frete da loja",
    state: "not_configured",
    detail: "A loja ainda não registrou uma verificação de cotação no runtime. Esta linha, e não o OAuth do painel, indica se /api/shipping/quote está pronta."
  };

  const state = ["online", "degraded", "offline", "not_configured"].includes(String(row.state))
    ? row.state as ServiceState : "unavailable";
  const summary = typeof row.error_summary === "string" && reasonLabels[row.error_summary]
    ? reasonLabels[row.error_summary] : "Último resultado do Worker da loja";
  const metadata = row.metadata_sanitized && typeof row.metadata_sanitized === "object" && !Array.isArray(row.metadata_sanitized)
    ? row.metadata_sanitized as Record<string, unknown> : {};
  const missing = safeConfigurationCodes(metadata.missing);
  const invalid = safeConfigurationCodes(metadata.invalid);
  const requirements = [...missing.map((name) => `ausente: ${name}`), ...invalid.map((name) => `inválido: ${name}`)];
  const requirementDetail = requirements.length ? ` · ${requirements.join(", ")}` : "";
  const environment = metadata.environment === "production" ? "Produção"
    : metadata.environment === "sandbox" ? "Sandbox" : "ambiente não identificado";
  const checkedAt = typeof row.checked_at === "string" ? row.checked_at : null;
  const checkedAtDetail = checkedAt ? ` · última verificação ${checkedAt}` : "";
  const supportCode = typeof metadata.supportCode === "string" && supportCodePattern.test(metadata.supportCode)
    ? metadata.supportCode : null;
  const supportDetail = supportCode ? ` · código ${supportCode}` : "";

  return {
    name: "Frete da loja",
    state,
    detail: `${summary} · ${environment}${requirementDetail}${supportDetail}${checkedAtDetail}`,
    checkedAt,
    latencyMs: typeof row.latency_ms === "number" ? row.latency_ms : null
  };
}
