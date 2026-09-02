import { sanitizeTechnicalValue } from "./technical-sanitizer";

export type ActivityOrigin = "person" | "system" | "integration";
export type ActivityAction = "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT" | "APPROVE" | "REJECT" | "BLOCK" | "UNBLOCK" | "PAY" | "REFUND" | "EXPORT" | "IMPORT" | "VIEW" | "OTHER";

export type ActivityLog = {
  id: string;
  actor_id: string | null;
  actor_name_snapshot: string | null;
  actor_email_snapshot: string | null;
  actor_role: string | null;
  action: string;
  action_type: ActivityAction;
  module: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  description: string;
  origin_type: ActivityOrigin;
  origin_name: string | null;
  previous_data_sanitized: unknown;
  new_data_sanitized: unknown;
  metadata_sanitized: unknown;
  changed_fields: string[];
  reason: string | null;
  request_id: string | null;
  ip_hash: string | null;
  user_agent_summary: string | null;
  created_at: string;
};

export type ActivityLogResponse = {
  items: ActivityLog[];
  total: number;
  page: number;
  pageSize: number;
  summary: { today: number; last7Days: number; deletions: number; financial: number; administrative: number };
  filters: {
    actors: Array<{ id: string; name: string; email: string | null }>;
    actions: ActivityAction[];
    modules: string[];
    origins: ActivityOrigin[];
  };
  capabilities: { export: boolean };
};

export type ActivityDiff = { field: string; before: unknown; after: unknown };

export const actionLabels: Record<ActivityAction, string> = {
  CREATE: "Criação",
  UPDATE: "Alteração",
  DELETE: "Exclusão",
  LOGIN: "Entrada",
  LOGOUT: "Saída",
  APPROVE: "Aprovação",
  REJECT: "Reprovação",
  BLOCK: "Bloqueio",
  UNBLOCK: "Desbloqueio",
  PAY: "Pagamento",
  REFUND: "Estorno",
  EXPORT: "Exportação",
  IMPORT: "Importação",
  VIEW: "Consulta",
  OTHER: "Outra ação"
};

const moduleLabels: Record<string, string> = {
  acessos: "Acessos e usuários",
  atendimento: "Atendimento",
  catalogo: "Catálogo",
  conteudo: "Conteúdo",
  estoque: "Estoque",
  financeiro: "Financeiro",
  integracoes: "Integrações",
  pedidos: "Pedidos e vendas",
  sistema: "Sistema",
  geral: "Geral"
};

export function moduleLabel(value: string): string {
  return moduleLabels[value] ?? value.replaceAll(/[._-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function originLabel(value: ActivityOrigin): string {
  return value === "person" ? "Pessoa" : value === "integration" ? "Integração" : "Sistema";
}

export function actorLabel(item: ActivityLog): string {
  return item.origin_type === "person"
    ? item.actor_name_snapshot || "Usuário removido"
    : item.origin_name || (item.origin_type === "integration" ? "Integração" : "Sistema curtiZ");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (sanitizeTechnicalValue(value) as Record<string, unknown>)
    : {};
}

export function activityDiff(item: Pick<ActivityLog, "previous_data_sanitized" | "new_data_sanitized" | "changed_fields">): ActivityDiff[] {
  const before = objectValue(item.previous_data_sanitized);
  const after = objectValue(item.new_data_sanitized);
  const fields = item.changed_fields.length
    ? item.changed_fields
    : [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  return fields.slice(0, 150).map((field) => ({ field, before: before[field], after: after[field] }));
}

export function displayAuditValue(value: unknown): string {
  const safe = sanitizeTechnicalValue(value);
  if (safe === undefined || safe === null || safe === "") return "—";
  if (typeof safe === "string") return safe;
  if (typeof safe === "number" || typeof safe === "boolean") return String(safe);
  return JSON.stringify(safe, null, 2);
}

export function isActivityLogResponse(value: unknown): value is ActivityLogResponse {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.items) && typeof record.total === "number" && typeof record.pageSize === "number" && record.summary !== null && typeof record.summary === "object" && record.filters !== null && typeof record.filters === "object" && record.capabilities !== null && typeof record.capabilities === "object";
}
