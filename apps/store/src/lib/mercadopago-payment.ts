export type LocalMercadoPagoStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back"
  | "in_review";

export const normalizeMercadoPagoStatus = (status: string): LocalMercadoPagoStatus => {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "cancelled") return "cancelled";
  if (status === "expired") return "cancelled";
  if (status === "refunded") return "refunded";
  if (status === "charged_back") return "charged_back";
  if (status === "in_review") return "in_review";
  if (status === "in_mediation") return "in_review";
  return "pending";
};

export const publicPaymentState = (
  status: LocalMercadoPagoStatus
): "approved" | "pending" | "rejected" | "cancelled" | "error" => {
  if (status === "approved" || status === "pending" || status === "rejected" || status === "cancelled") {
    return status;
  }
  return status === "refunded" ? "cancelled" : "error";
};
