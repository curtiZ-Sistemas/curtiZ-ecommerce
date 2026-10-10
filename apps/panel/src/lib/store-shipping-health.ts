type ServiceState = "online" | "degraded" | "offline" | "configured" | "not_configured" | "mock" | "unavailable";
export type StoreShippingService = {
  name: string;
  state: ServiceState;
  detail: string;
  checkedAt?: string | null;
  latencyMs?: number | null;
  /** Identificador público da chave ativa de tokens usada pela loja na última cotação. */
  tokenKeyId?: string | null;
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
const failureLabels: Readonly<Record<string, string>> = {
  credentials_missing: "Não há conexão OAuth ativa para o ambiente da loja",
  credentials_read_failed: "A RPC de leitura das credenciais falhou no Supabase",
  credentials_write_failed: "A RPC de persistência dos tokens renovados falhou no Supabase",
  token_decryption_failed: "Não foi possível decifrar os tokens com as chaves configuradas; confira a chave ativa e, durante a troca, MELHOR_ENVIO_TOKEN_ENCRYPTION_PREVIOUS_KEYS",
  token_key_unavailable: "Os tokens foram cifrados por uma chave que não está configurada neste Worker; configure-a como chave anterior ou reconecte o OAuth",
  refresh_token_expired: "O refresh token expirou; reconecte o aplicativo no ambiente selecionado",
  oauth_rejected: "O endpoint OAuth rejeitou as credenciais/token; confira Client ID, Client Secret e a autorização do ambiente",
  permission_denied: "A API negou a permissão; confira shipping-calculate e a conta/aplicativo do ambiente",
  refresh_lock_failed: "A RPC de bloqueio para renovar o token falhou no Supabase",
  refresh_lock_timeout: "A renovação do token está ocupada; tente novamente"
};

export const melhorEnvioFailureLabel = (reason: unknown): string | null =>
  typeof reason === "string" && Object.hasOwn(failureLabels, reason) ? failureLabels[reason] ?? null : null;

const safeConfigurationCodes = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string =>
    typeof item === "string" && /^MELHOR_ENVIO_[A-Z0-9_]+$/u.test(item)))]
  : [];

export function getStoreShippingService(value: unknown, queryFailed = false): StoreShippingService {
  if (queryFailed) return {
    name: "Frete da loja", state: "unavailable",
    detail: "Não foi possível consultar o diagnóstico da loja no Supabase."
  };
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!row) return {
    name: "Frete da loja",
    state: "unavailable",
    detail: "A loja ainda não registrou uma verificação de cotação no runtime. Esta linha mostra o último resultado de /api/shipping/quote; o OAuth do painel verifica outra conexão."
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
  const failureDetail = typeof metadata.reason === "string" && failureLabels[metadata.reason]
    ? ` · ${failureLabels[metadata.reason]}` : "";
  const upstreamDetail = typeof metadata.upstreamStatus === "number" && Number.isInteger(metadata.upstreamStatus)
    && metadata.upstreamStatus >= 100 && metadata.upstreamStatus <= 599 ? ` · HTTP Melhor Envio ${metadata.upstreamStatus}` : "";
  const databaseDetail = typeof metadata.databaseCode === "string" && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/u.test(metadata.databaseCode)
    ? ` · código do banco ${metadata.databaseCode}` : "";

  return {
    name: "Frete da loja",
    state,
    detail: `${summary} · ${environment}${requirementDetail}${failureDetail}${upstreamDetail}${databaseDetail}${supportDetail}${checkedAtDetail}`,
    checkedAt,
    latencyMs: typeof row.latency_ms === "number" ? row.latency_ms : null,
    tokenKeyId: typeof metadata.tokenKeyId === "string" && /^[0-9a-f]{12}$/u.test(metadata.tokenKeyId) ? metadata.tokenKeyId : null
  };
}
