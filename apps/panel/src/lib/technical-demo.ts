import { type TechnicalRecord } from "./technical-sanitizer";

export function technicalDemoResourceRows(resource: string): TechnicalRecord[] {
  if (resource !== "integracoes") return [];
  return [
    {
      provider: "Provedor externo",
      state: "not_configured",
      checked_at: null,
      latency_ms: null,
      error_summary: "Configuração não cadastrada no ambiente de demonstração",
      metadata_sanitized: { demo: true }
    },
    {
      provider: "Credenciais externas",
      state: "awaiting_credentials",
      checked_at: null,
      latency_ms: null,
      error_summary: "Credenciais não cadastradas no ambiente de demonstração",
      metadata_sanitized: { demo: true }
    }
  ];
}
