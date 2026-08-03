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
  active: "Ativo"
};

export const customerStatusLabel = (status: string) =>
  statusLabels[status] ?? status.replaceAll("_", " ");
