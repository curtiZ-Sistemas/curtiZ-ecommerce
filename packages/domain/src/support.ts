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

export const supportCategories = [
  "order",
  "payment",
  "delivery",
  "return",
  "product",
  "account",
  "technical",
  "other"
] as const;

export type SupportCategory = (typeof supportCategories)[number];

export const supportCategoryLabels: Record<SupportCategory, string> = {
  order: "Pedido",
  payment: "Pagamento",
  delivery: "Entrega",
  return: "Troca ou devolução",
  product: "Produto",
  account: "Conta",
  technical: "Problema técnico",
  other: "Outro"
};

export type SupportMessageView = {
  id: string;
  author: "customer" | "team" | "internal";
  content: string;
  createdAt: string;
};

export type SupportConversationView = {
  id: string;
  publicCode: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  customerName: string;
  relatedOrderCode: string | null;
  assignedRole: "admin" | "operational" | "manager" | "technical";
  assignedToCurrentUser: boolean;
  assignedName: string | null;
  createdAt: string;
  updatedAt: string;
  messages: SupportMessageView[];
};

export type SupportTeamMember = {
  id: string;
  fullName: string;
  role: "operational" | "manager" | "technical";
  demo: boolean;
};

export const customerVisibleSupportStatuses = new Set<SupportStatus>([
  "open",
  "queued",
  "assigned",
  "in_progress",
  "waiting_customer",
  "resolved",
  "closed",
  "reopened"
]);

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
