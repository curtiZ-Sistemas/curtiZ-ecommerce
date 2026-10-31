export const orderTransitions = {
  draft: ["pending_payment", "cancelled"],
  pending_payment: ["payment_approved", "cancelled", "manual_review"],
  payment_approved: ["processing", "refund_pending", "manual_review"],
  processing: ["picking", "refund_pending"],
  picking: ["ready_to_ship", "manual_review", "refund_pending"],
  ready_to_ship: ["shipped", "refund_pending"],
  shipped: ["delivered", "return_requested"],
  delivered: ["return_requested"],
  // Only a provider-verification hold; never an operational approval queue.
  cancellation_requested: ["cancelled", "refund_pending", "manual_review"],
  return_requested: ["returned"],
  returned: ["refund_pending"],
  refund_pending: ["refunded", "manual_review"],
  refunded: [],
  cancelled: [],
  manual_review: ["processing", "cancelled", "refund_pending"]
} as const;

export type OrderStatus = keyof typeof orderTransitions;

export const canTransitionOrder = (from: OrderStatus, to: OrderStatus): boolean =>
  (orderTransitions[from] as readonly string[]).includes(to);
