type CustomerOrderVisibilityInput = {
  orderStatus: string;
  paymentStatus: string;
  paymentStatusDetail: string;
  paymentExpiresAt?: string;
  cancellationCompletedAt?: string;
  refundStatus?: string;
  refundCompletedAt?: string;
  hadApprovedPayment?: boolean;
  hasPaymentAttempt: boolean;
  hasPaymentMethod: boolean;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const isBeforeRetentionEnd = (
  completedAt: string | undefined,
  retentionDays: number,
  now: number
) => {
  const timestamp = completedAt ? Date.parse(completedAt) : Number.NaN;
  return !Number.isFinite(timestamp) || now < timestamp + retentionDays * DAY_IN_MS;
};

export const isCustomerOrderVisible = (
  order: CustomerOrderVisibilityInput,
  now = Date.now()
) => {
  const refundIsUnresolved = ["pending", "failed", "manual_review"].includes(
    order.refundStatus ?? ""
  );

  if (order.orderStatus === "refund_pending" || refundIsUnresolved) return true;

  if (order.orderStatus === "refunded") {
    return order.refundStatus !== "completed"
      || isBeforeRetentionEnd(order.refundCompletedAt, 10, now);
  }

  if (order.orderStatus === "cancelled") {
    const hadApprovedPayment = order.hadApprovedPayment
      || ["approved", "refunded"].includes(order.paymentStatus);
    if (hadApprovedPayment || order.refundStatus) {
      return order.refundStatus !== "completed"
        || isBeforeRetentionEnd(order.refundCompletedAt, 10, now);
    }
    return isBeforeRetentionEnd(order.cancellationCompletedAt, 3, now);
  }

  const expiresAt = order.paymentExpiresAt
    ? Date.parse(order.paymentExpiresAt)
    : Number.NaN;
  const isExpired = order.paymentStatusDetail === "expired"
    || (["pending", "rejected", "cancelled"].includes(order.paymentStatus)
      && Number.isFinite(expiresAt)
      && expiresAt <= now);

  if (isExpired || order.orderStatus === "expired" || order.paymentStatus === "expired") return false;

  return order.hasPaymentAttempt && order.hasPaymentMethod;
};
