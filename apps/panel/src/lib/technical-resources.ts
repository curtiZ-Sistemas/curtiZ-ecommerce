export type TechnicalColumn = {
  key: string;
  label: string;
  format?: "date" | "datetime" | "status" | "json" | "bytes" | "duration";
};

export type TechnicalResourceDefinition = {
  label: string;
  description: string;
  table: string;
  select: string;
  columns: readonly TechnicalColumn[];
  searchColumns: readonly string[];
  orderColumn: string;
  dateColumn?: string;
  statusColumn?: string;
  exportAllowed?: boolean;
};

export const technicalResourceKeys = [
  "logs",
  "erros",
  "seguranca",
  "acessos-tecnicos",
  "integracoes",
  "webhooks",
  "filas",
  "jobs",
  "falhas",
  "auditoria-tecnica",
  "performance",
  "feature-flags"
] as const;

export type TechnicalResourceKey = (typeof technicalResourceKeys)[number];

export const technicalResources: Record<TechnicalResourceKey, TechnicalResourceDefinition> = {
  logs: {
    label: "Logs técnicos",
    description: "Eventos sanitizados com busca, correlação, origem, nível e período.",
    table: "technical_events",
    select: "id,severity,source,event_type,message,context_sanitized,user_id,route,duration_ms,request_id,resolution_status,assigned_to,resolution_note,created_at",
    columns: [
      { key: "severity", label: "Nível", format: "status" },
      { key: "source", label: "Serviço" },
      { key: "event_type", label: "Evento" },
      { key: "route", label: "Rota" },
      { key: "user_id", label: "Usuário" },
      { key: "message", label: "Mensagem" },
      { key: "request_id", label: "Correlação" },
      { key: "resolution_status", label: "Resolução", format: "status" },
      { key: "created_at", label: "Horário", format: "datetime" }
    ],
    searchColumns: ["message", "source", "event_type", "route"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "resolution_status",
    exportAllowed: true
  },
  erros: {
    label: "Erros",
    description: "Falhas reais agrupáveis por origem, mensagem e estado de resolução.",
    table: "technical_events",
    select: "id,severity,source,event_type,message,context_sanitized,user_id,route,duration_ms,request_id,resolution_status,assigned_to,resolution_note,created_at",
    columns: [
      { key: "severity", label: "Nível", format: "status" },
      { key: "source", label: "Origem" },
      { key: "route", label: "Rota" },
      { key: "message", label: "Mensagem" },
      { key: "frequency_on_page", label: "Frequência na página" },
      { key: "request_id", label: "Correlação" },
      { key: "resolution_status", label: "Status", format: "status" },
      { key: "assigned_to", label: "Responsável" },
      { key: "created_at", label: "Horário", format: "datetime" }
    ],
    searchColumns: ["message", "source", "event_type", "route"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "resolution_status",
    exportAllowed: true
  },
  seguranca: {
    label: "Segurança",
    description: "Tentativas de acesso e eventos sensíveis sem credenciais ou dados pessoais em claro.",
    table: "security_events",
    select: "id,user_id,event_type,severity,request_id,ip_hash,context_sanitized,created_at",
    columns: [
      { key: "severity", label: "Nível", format: "status" },
      { key: "event_type", label: "Evento" },
      { key: "user_id", label: "Usuário" },
      { key: "request_id", label: "Correlação" },
      { key: "ip_hash", label: "IP anonimizado" },
      { key: "created_at", label: "Horário", format: "datetime" }
    ],
    searchColumns: ["event_type", "severity"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    exportAllowed: true
  },
  "acessos-tecnicos": {
    label: "Acessos técnicos",
    description: "Alterações de acesso registradas na trilha imutável de auditoria.",
    table: "audit_logs",
    select: "id,actor_id,actor_role,action,entity_type,entity_id,reason,request_id,created_at",
    columns: [
      { key: "actor_id", label: "Ator" },
      { key: "actor_role", label: "Perfil", format: "status" },
      { key: "action", label: "Ação" },
      { key: "entity_type", label: "Recurso" },
      { key: "reason", label: "Justificativa" },
      { key: "created_at", label: "Horário", format: "datetime" }
    ],
    searchColumns: ["action", "entity_type", "reason"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    exportAllowed: true
  },
  integracoes: {
    label: "Integrações",
    description: "Último estado persistido por serviço; configuração ausente e mock são identificados separadamente.",
    table: "integration_health",
    select: "provider,state,checked_at,latency_ms,error_summary,metadata_sanitized",
    columns: [
      { key: "provider", label: "Serviço" },
      { key: "state", label: "Estado", format: "status" },
      { key: "checked_at", label: "Verificado em", format: "datetime" },
      { key: "latency_ms", label: "Latência", format: "duration" },
      { key: "error_summary", label: "Erro" },
      { key: "metadata_sanitized", label: "Detalhes seguros", format: "json" }
    ],
    searchColumns: ["provider", "state", "error_summary"],
    orderColumn: "checked_at",
    dateColumn: "checked_at",
    statusColumn: "state"
  },
  webhooks: {
    label: "Webhooks",
    description: "Eventos de pagamento sem payload bruto, com assinatura, tentativas e processamento.",
    table: "payment_events",
    select: "id,provider,provider_event_id,event_type,payload_hash,signature_valid,processing_status,attempts,received_at,processed_at,error_summary",
    columns: [
      { key: "provider", label: "Provedor" },
      { key: "event_type", label: "Evento" },
      { key: "signature_valid", label: "Assinatura", format: "status" },
      { key: "processing_status", label: "Processamento", format: "status" },
      { key: "attempts", label: "Tentativas" },
      { key: "duration_ms", label: "Duração", format: "duration" },
      { key: "received_at", label: "Recebido em", format: "datetime" },
      { key: "error_summary", label: "Erro" }
    ],
    searchColumns: ["provider", "provider_event_id", "event_type", "processing_status"],
    orderColumn: "received_at",
    dateColumn: "received_at",
    statusColumn: "processing_status",
    exportAllowed: true
  },
  filas: {
    label: "Filas",
    description: "Jobs por fila e estado, com ações restritas às transições válidas.",
    table: "background_jobs",
    select: "id,queue,job_type,payload_sanitized,status,attempts,available_at,locked_at,completed_at,error_summary,created_at",
    columns: [
      { key: "queue", label: "Fila" },
      { key: "job_type", label: "Tipo" },
      { key: "status", label: "Status", format: "status" },
      { key: "attempts", label: "Tentativas" },
      { key: "duration_ms", label: "Duração", format: "duration" },
      { key: "available_at", label: "Disponível em", format: "datetime" },
      { key: "error_summary", label: "Erro" }
    ],
    searchColumns: ["queue", "job_type", "status", "error_summary"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "status"
  },
  jobs: {
    label: "Jobs",
    description: "Execuções pendentes, em processamento, concluídas, falhas ou canceladas.",
    table: "background_jobs",
    select: "id,queue,job_type,payload_sanitized,status,attempts,available_at,locked_at,completed_at,error_summary,created_at",
    columns: [
      { key: "job_type", label: "Job" },
      { key: "queue", label: "Fila" },
      { key: "status", label: "Status", format: "status" },
      { key: "attempts", label: "Tentativas" },
      { key: "duration_ms", label: "Duração", format: "duration" },
      { key: "created_at", label: "Criado em", format: "datetime" },
      { key: "completed_at", label: "Concluído em", format: "datetime" },
      { key: "error_summary", label: "Erro" }
    ],
    searchColumns: ["queue", "job_type", "status", "error_summary"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "status"
  },
  falhas: {
    label: "Falhas de jobs",
    description: "Jobs falhos disponíveis para revisão e reprocessamento justificado.",
    table: "background_jobs",
    select: "id,queue,job_type,status,attempts,completed_at,error_summary,created_at",
    columns: [
      { key: "job_type", label: "Job" },
      { key: "queue", label: "Fila" },
      { key: "attempts", label: "Tentativas" },
      { key: "error_summary", label: "Falha" },
      { key: "created_at", label: "Criado em", format: "datetime" }
    ],
    searchColumns: ["queue", "job_type", "error_summary"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "status"
  },
  "auditoria-tecnica": {
    label: "Auditoria técnica",
    description: "Ações técnicas com ator, recurso, justificativa e correlação.",
    table: "audit_logs",
    select: "id,actor_id,actor_role,action,entity_type,entity_id,reason,request_id,new_data_sanitized,created_at",
    columns: [
      { key: "actor_id", label: "Ator" },
      { key: "action", label: "Ação" },
      { key: "entity_type", label: "Recurso" },
      { key: "reason", label: "Justificativa" },
      { key: "request_id", label: "Correlação" },
      { key: "created_at", label: "Horário", format: "datetime" }
    ],
    searchColumns: ["action", "entity_type", "reason"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    exportAllowed: true
  },
  performance: {
    label: "Performance",
    description: "Somente eventos de performance efetivamente registrados pelas aplicações.",
    table: "technical_events",
    select: "id,severity,source,event_type,message,context_sanitized,user_id,route,duration_ms,request_id,created_at",
    columns: [
      { key: "source", label: "Origem" },
      { key: "event_type", label: "Métrica" },
      { key: "route", label: "Rota" },
      { key: "duration_ms", label: "Duração", format: "duration" },
      { key: "message", label: "Descrição" },
      { key: "context_sanitized", label: "Valores", format: "json" },
      { key: "created_at", label: "Horário", format: "datetime" }
    ],
    searchColumns: ["source", "event_type", "message", "route"],
    orderColumn: "created_at",
    dateColumn: "created_at"
  },
  "feature-flags": {
    label: "Feature flags",
    description: "Flags existentes com mudança auditada; novas chaves não são criadas pelo navegador.",
    table: "feature_flags",
    select: "key,enabled,target_roles,metadata,updated_by,updated_at",
    columns: [
      { key: "key", label: "Flag" },
      { key: "enabled", label: "Ativa", format: "status" },
      { key: "target_roles", label: "Perfis", format: "json" },
      { key: "metadata", label: "Metadados", format: "json" },
      { key: "updated_by", label: "Atualizada por" },
      { key: "updated_at", label: "Atualizada em", format: "datetime" }
    ],
    searchColumns: ["key"],
    orderColumn: "updated_at",
    statusColumn: "enabled"
  }
};

export function isTechnicalResource(value: string): value is TechnicalResourceKey {
  return technicalResourceKeys.includes(value as TechnicalResourceKey);
}
