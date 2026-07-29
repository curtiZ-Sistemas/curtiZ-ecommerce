export const supportStatuses = [
  "open",
  "queued",
  "assigned",
  "in_progress",
  "waiting_customer",
  "waiting_internal",
  "escalated",
  "resolved",
  "closed",
  "reopened",
  "spam",
  "cancelled"
] as const;

export type SupportStatus = (typeof supportStatuses)[number];
export type SupportPriority = "low" | "normal" | "high" | "urgent";

export const supportStatusLabels: Record<SupportStatus, string> = {
  open: "Aberto",
  queued: "Na fila",
  assigned: "Atribuído",
  in_progress: "Em atendimento",
  waiting_customer: "Aguardando cliente",
  waiting_internal: "Aguardando setor interno",
  escalated: "Escalado",
  resolved: "Resolvido",
  closed: "Encerrado",
  reopened: "Reaberto",
  spam: "Spam",
  cancelled: "Cancelado"
};

export const initialSupportAssignment = {
  status: "queued" as const,
  assignedRole: "admin" as const,
  assignedUserId: null
};
