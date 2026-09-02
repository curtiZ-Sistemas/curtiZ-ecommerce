export type ManagerColumn = {
  key: string;
  label: string;
  format?: "money" | "cents" | "date" | "datetime" | "status" | "json";
};

export type ManagerResourceDefinition = {
  label: string;
  description: string;
  table: string;
  select: string;
  columns: readonly ManagerColumn[];
  searchColumns: readonly string[];
  orderColumn: string;
  dateColumn?: string;
  statusColumn?: string;
  fixedStatus?: string;
  exportAllowed?: boolean;
};

export const managerResourceKeys = [
  "pedidos-vendas",
  "clientes",
  "representantes",
  "rede-indicacoes",
  "niveis",
  "qualificacao",
  "metas",
  "kits",
  "comissoes",
  "fechamentos",
  "pagamentos",
  "campanhas",
  "banners",
  "relatorios",
  "simulacoes",
  "configuracoes-estrategicas"
] as const;

export type ManagerResourceKey = (typeof managerResourceKeys)[number];

export const managerResources: Record<ManagerResourceKey, ManagerResourceDefinition> = {
  "pedidos-vendas": {
    label: "Pedidos e vendas",
    description: "Acompanhe pedidos, pagamentos e resultado disponível por período.",
    table: "orders",
    select: "id,public_code,status,payment_status,grand_total,estimated_profit,created_at",
    columns: [
      { key: "public_code", label: "Pedido" },
      { key: "status", label: "Status", format: "status" },
      { key: "payment_status", label: "Pagamento", format: "status" },
      { key: "grand_total", label: "Total", format: "money" },
      { key: "estimated_profit", label: "Resultado estimado", format: "money" },
      { key: "created_at", label: "Criado em", format: "datetime" }
    ],
    searchColumns: ["public_code", "customer_email_snapshot"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "status",
    exportAllowed: true
  },
  clientes: {
    label: "Clientes",
    description: "Cadastros limitados aos dados necessários para análise gerencial.",
    table: "profiles",
    select: "id,full_name,email_snapshot,status,created_at",
    columns: [
      { key: "full_name", label: "Nome" },
      { key: "email_snapshot", label: "E-mail" },
      { key: "status", label: "Status", format: "status" },
      { key: "created_at", label: "Cadastro", format: "datetime" }
    ],
    searchColumns: ["full_name", "email_snapshot"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "status"
  },
  representantes: {
    label: "Representantes",
    description: "Situação, nível e região da rede com ações sensíveis auditadas.",
    table: "representatives",
    select: "id,public_code,status,current_level_id,region_code,approved_at,activated_at",
    columns: [
      { key: "public_code", label: "Representante" },
      { key: "status", label: "Status", format: "status" },
      { key: "current_level_id", label: "Nível" },
      { key: "region_code", label: "Região" },
      { key: "approved_at", label: "Aprovado em", format: "datetime" },
      { key: "activated_at", label: "Ativado em", format: "datetime" }
    ],
    searchColumns: ["public_code", "referral_code", "region_code"],
    orderColumn: "approved_at",
    dateColumn: "approved_at",
    statusColumn: "status"
  },
  "rede-indicacoes": {
    label: "Rede de indicações",
    description: "Estrutura persistida da rede, sem inferir vínculos no navegador.",
    table: "representative_network_closure",
    select: "ancestor_id,descendant_id,depth,created_at",
    columns: [
      { key: "ancestor_id", label: "Patrocinador" },
      { key: "descendant_id", label: "Representante" },
      { key: "depth", label: "Profundidade" },
      { key: "created_at", label: "Registrado em", format: "datetime" }
    ],
    searchColumns: [],
    orderColumn: "created_at"
  },
  niveis: {
    label: "Níveis",
    description: "Configuração vigente de progressão da rede.",
    table: "representative_levels",
    select: "id,name,rank,description,active,updated_at",
    columns: [
      { key: "name", label: "Nível" },
      { key: "rank", label: "Posição" },
      { key: "description", label: "Descrição" },
      { key: "active", label: "Ativo", format: "status" },
      { key: "updated_at", label: "Atualizado em", format: "datetime" }
    ],
    searchColumns: ["name", "description"],
    orderColumn: "rank",
    statusColumn: "active"
  },
  qualificacao: {
    label: "Qualificação",
    description: "Resultados persistidos das regras de qualificação.",
    table: "representative_qualifications",
    select: "id,representative_id,rule_id,period_start,period_end,qualified,evaluated_at",
    columns: [
      { key: "representative_id", label: "Representante" },
      { key: "period_start", label: "Início", format: "date" },
      { key: "period_end", label: "Fim", format: "date" },
      { key: "qualified", label: "Qualificado", format: "status" },
      { key: "evaluated_at", label: "Avaliado em", format: "datetime" }
    ],
    searchColumns: [],
    orderColumn: "evaluated_at",
    dateColumn: "evaluated_at",
    statusColumn: "qualified"
  },
  metas: {
    label: "Metas",
    description: "Metas individuais ou por nível com critérios persistidos.",
    table: "representative_goals",
    select: "id,title,representative_id,level_id,period_start,period_end,target,active,created_at",
    columns: [
      { key: "title", label: "Meta" },
      { key: "period_start", label: "Início", format: "date" },
      { key: "period_end", label: "Fim", format: "date" },
      { key: "target", label: "Critério", format: "json" },
      { key: "active", label: "Ativa", format: "status" }
    ],
    searchColumns: ["title"],
    orderColumn: "created_at",
    statusColumn: "active"
  },
  kits: {
    label: "Kits",
    description: "Pedidos de kits, pagamentos e andamento logístico.",
    table: "kit_orders",
    select: "id,public_code,representative_id,status,total_in_cents,paid_at,created_at",
    columns: [
      { key: "public_code", label: "Pedido" },
      { key: "representative_id", label: "Representante" },
      { key: "status", label: "Status", format: "status" },
      { key: "total_in_cents", label: "Total", format: "cents" },
      { key: "paid_at", label: "Pagamento", format: "datetime" }
    ],
    searchColumns: ["public_code"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "status",
    exportAllowed: true
  },
  comissoes: {
    label: "Comissões",
    description: "Lançamentos calculados pelas regras versionadas.",
    table: "commission_entries",
    select:
      "id,representative_id,status,eligible_amount_in_cents,commission_in_cents,source_event,reversal_of,created_at",
    columns: [
      { key: "representative_id", label: "Representante" },
      { key: "source_event", label: "Origem" },
      { key: "eligible_amount_in_cents", label: "Base", format: "cents" },
      { key: "commission_in_cents", label: "Comissão", format: "cents" },
      { key: "status", label: "Status", format: "status" },
      { key: "reversal_of", label: "Estorno de" },
      { key: "created_at", label: "Criada em", format: "datetime" }
    ],
    searchColumns: ["source_event"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "status",
    exportAllowed: true
  },
  fechamentos: {
    label: "Fechamentos de comissão",
    description: "Simulações, aprovações, bloqueios e reaberturas auditadas.",
    table: "commission_closings",
    select:
      "id,public_code,period_start,period_end,status,totals_snapshot,locked_at,reopen_reason,created_at",
    columns: [
      { key: "public_code", label: "Fechamento" },
      { key: "period_start", label: "Início", format: "date" },
      { key: "period_end", label: "Fim", format: "date" },
      { key: "status", label: "Status", format: "status" },
      { key: "totals_snapshot", label: "Totais", format: "json" },
      { key: "locked_at", label: "Bloqueado em", format: "datetime" }
    ],
    searchColumns: ["public_code"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "status",
    exportAllowed: true
  },
  pagamentos: {
    label: "Pagamentos de comissão",
    description: "Pagamentos efetivamente registrados, sem simular integrações.",
    table: "commission_payments",
    select: "id,representative_id,amount_in_cents,status,provider_reference,paid_at,created_at",
    columns: [
      { key: "representative_id", label: "Representante" },
      { key: "amount_in_cents", label: "Valor", format: "cents" },
      { key: "status", label: "Status", format: "status" },
      { key: "provider_reference", label: "Referência" },
      { key: "paid_at", label: "Pago em", format: "datetime" }
    ],
    searchColumns: ["provider_reference"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "status",
    exportAllowed: true
  },
  campanhas: {
    label: "Campanhas",
    description: "Campanhas reais e seus estados de aprovação/publicação.",
    table: "creative_campaigns",
    select: "id,name,slug,status,approval_mode,starts_at,ends_at,updated_at",
    columns: [
      { key: "name", label: "Campanha" },
      { key: "status", label: "Status", format: "status" },
      { key: "approval_mode", label: "Aprovação" },
      { key: "starts_at", label: "Início", format: "datetime" },
      { key: "ends_at", label: "Fim", format: "datetime" }
    ],
    searchColumns: ["name", "slug"],
    orderColumn: "updated_at",
    dateColumn: "updated_at",
    statusColumn: "status"
  },
  banners: {
    label: "Banners",
    description: "Banners da loja, destinos, agenda e estado de publicação.",
    table: "banners",
    select: "id,title,position,status,destination_url,starts_at,ends_at,updated_at",
    columns: [
      { key: "title", label: "Banner" },
      { key: "position", label: "Posição" },
      { key: "status", label: "Status", format: "status" },
      { key: "destination_url", label: "Destino" },
      { key: "starts_at", label: "Início", format: "datetime" },
      { key: "ends_at", label: "Fim", format: "datetime" }
    ],
    searchColumns: ["title", "position", "destination_url"],
    orderColumn: "updated_at",
    dateColumn: "updated_at",
    statusColumn: "status"
  },
  relatorios: {
    label: "Relatórios",
    description: "Histórico de exportações solicitadas e seu estado real.",
    table: "report_exports",
    select: "id,report_type,format,status,created_at,completed_at,error_summary",
    columns: [
      { key: "report_type", label: "Relatório" },
      { key: "format", label: "Formato" },
      { key: "status", label: "Status", format: "status" },
      { key: "created_at", label: "Solicitado em", format: "datetime" },
      { key: "completed_at", label: "Concluído em", format: "datetime" },
      { key: "error_summary", label: "Erro" }
    ],
    searchColumns: ["report_type", "format", "status"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    statusColumn: "status"
  },
  simulacoes: {
    label: "Simulações de comissão",
    description: "Fechamentos em simulação, sem apresentá-los como valores pagos.",
    table: "commission_closings",
    select: "id,public_code,period_start,period_end,status,totals_snapshot,created_at",
    columns: [
      { key: "public_code", label: "Simulação" },
      { key: "period_start", label: "Início", format: "date" },
      { key: "period_end", label: "Fim", format: "date" },
      { key: "totals_snapshot", label: "Totais", format: "json" },
      { key: "created_at", label: "Criada em", format: "datetime" }
    ],
    searchColumns: ["public_code"],
    orderColumn: "created_at",
    dateColumn: "created_at",
    fixedStatus: "simulating"
  },
  "configuracoes-estrategicas": {
    label: "Configurações estratégicas",
    description: "Políticas comerciais versionadas; segredos não são exibidos.",
    table: "commercial_policies",
    select: "id,version,rules,active_from,active_until,created_at",
    columns: [
      { key: "version", label: "Versão" },
      { key: "rules", label: "Regras", format: "json" },
      { key: "active_from", label: "Início", format: "datetime" },
      { key: "active_until", label: "Fim", format: "datetime" }
    ],
    searchColumns: [],
    orderColumn: "version"
  }
};

export function isManagerResource(value: string): value is ManagerResourceKey {
  return managerResourceKeys.includes(value as ManagerResourceKey);
}
