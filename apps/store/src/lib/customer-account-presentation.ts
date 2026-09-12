const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  pending_payment: "Aguardando pagamento",
  payment_approved: "Pagamento aprovado",
  processing: "Em preparação",
  picking: "Em separação",
  ready_to_ship: "Pronto para envio",
  shipped: "Enviado",
  delivered: "Entregue",
  cancellation_requested: "Cancelamento solicitado",
  cancelled: "Cancelado",
  return_requested: "Devolução solicitada",
  returned: "Devolvido",
  refund_pending: "Reembolso pendente",
  refunded: "Reembolsado",
  manual_review: "Em análise",
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Ajustes solicitados",
  requested: "Solicitada",
  under_review: "Em análise",
  documents_pending: "Documentos pendentes",
  approved_waiting_kit: "Aprovado · kit pendente",
  active: "Ativo",
  inactive: "Inativo",
  unqualified: "Ativo · qualificação pendente",
  suspended: "Suspenso"
};

export const customerStatusLabel = (status: string) =>
  statusLabels[status] ?? status.replaceAll("_", " ");

export const canContinueOrderPayment = (
  orderStatus: string,
  paymentStatus: string,
  paymentMethod: string | undefined,
  statusDetail = "",
  expiresAt = "",
  now = Date.now()
) => orderStatus === "pending_payment"
  && ["pending", "rejected"].includes(paymentStatus)
  && Boolean(paymentMethod)
  && statusDetail !== "expired"
  && (!expiresAt || Date.parse(expiresAt) > now);

export const customerOrderActionLabel = (status: string) => {
  if (status === "shipped") return "Rastrear pedido";
  if (status === "cancellation_requested") return "Cancelamento solicitado";
  if (status === "cancelled") return "Cancelado";
  if (["payment_approved", "processing", "picking", "ready_to_ship"].includes(status)) {
    return "Acompanhar pedido";
  }
  return "Ver detalhes";
};

export const matchesCustomerOrderFilter = (status: string, filter: string) => {
  if (filter === "all") return true;
  if (filter === "preparing") {
    return ["payment_approved", "processing", "picking", "ready_to_ship"].includes(status);
  }
  return status === filter;
};

type CustomerOrderProgressState = "complete" | "current" | "upcoming";

export type CustomerOrderProgressStep = {
  label: string;
  state: CustomerOrderProgressState;
};

export const customerOrderProgress = (status: string): CustomerOrderProgressStep[] => {
  const stages = [
    { statuses: ["pending_payment"], label: "Pedido realizado" },
    { statuses: ["payment_approved"], label: "Pagamento confirmado" },
    { statuses: ["processing", "picking", "ready_to_ship"], label: "Preparando pedido" },
    { statuses: ["shipped"], label: "Enviado" },
    { statuses: ["delivered"], label: "Entregue" }
  ];
  const stageIndex = stages.findIndex((stage) => stage.statuses.includes(status));

  if (stageIndex < 0) {
    return [{ label: customerStatusLabel(status), state: "current" }];
  }

  return stages.map((stage, index) => ({
    label: status === "pending_payment" && index === 1 ? "Processando pagamento" : stage.label,
    state: index < stageIndex || (status === "pending_payment" && index === 0)
      ? "complete"
      : index === stageIndex || (status === "pending_payment" && index === 1)
        ? "current"
        : "upcoming"
  }));
};
