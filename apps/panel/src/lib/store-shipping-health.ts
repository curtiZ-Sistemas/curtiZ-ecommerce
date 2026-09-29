type ServiceState = "online" | "degraded" | "offline" | "configured" | "not_configured" | "mock" | "unavailable";
export type StoreShippingService = {
  name: string;
  state: ServiceState;
  detail: string;
  checkedAt?: string | null;
  latencyMs?: number | null;
};

const reasonLabels: Readonly<Record<string, string>> = {
  shipping_provider_disabled: "Frete desabilitado na configuração efetiva da loja",
  shipping_provider_unsupported: "O provider de frete selecionado não tem cotação disponível na loja",
  melhor_envio_not_configured: "Configuração do Melhor Envio incompleta na loja",
  melhor_envio_authentication: "Autenticação do Melhor Envio falhou na loja",
  melhor_envio_provider_unavailable: "Provedor de frete indisponível na loja",
  melhor_envio_validation: "O Melhor Envio rejeitou os dados da cotação",
  melhor_envio_timeout: "Tempo limite excedido ao consultar o Melhor Envio"
};

const safeConfigurationCodes = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string =>
    typeof item === "string" && /^MELHOR_ENVIO_[A-Z0-9_]+$/u.test(item)))]
  : [];

export function getStoreShippingService(value: unknown): StoreShippingService {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!row) return {
    name: "Frete da loja",
    state: "not_configured",
    detail: "A loja ainda não registrou uma verificação de cotação no runtime."
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

  return {
    name: "Frete da loja",
    state,
    detail: `${summary} · ${environment}${requirementDetail}${checkedAtDetail}`,
    checkedAt,
    latencyMs: typeof row.latency_ms === "number" ? row.latency_ms : null
  };
}
