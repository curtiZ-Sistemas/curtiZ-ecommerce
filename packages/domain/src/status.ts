export const orderTransitions = {
  draft: ["pending_payment", "cancelled"],
  pending_payment: ["payment_approved", "cancelled", "manual_review"],
  payment_approved: ["processing", "cancellation_requested", "manual_review"],
  processing: ["picking", "cancellation_requested"],
  picking: ["ready_to_ship", "manual_review"],
  ready_to_ship: ["shipped"],
  shipped: ["delivered", "return_requested"],
  delivered: ["return_requested"],
  cancellation_requested: ["cancelled", "processing"],
  return_requested: ["returned"],
  returned: ["refund_pending"],
  refund_pending: ["refunded"],
  refunded: [],
  cancelled: [],
  manual_review: ["processing", "cancelled", "refund_pending"]
} as const;

export type OrderStatus = keyof typeof orderTransitions;

export const canTransitionOrder = (from: OrderStatus, to: OrderStatus): boolean =>
  (orderTransitions[from] as readonly string[]).includes(to);
