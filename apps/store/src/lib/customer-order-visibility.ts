type CustomerOrderVisibilityInput = {
  orderStatus: string;
  paymentStatus: string;
  paymentStatusDetail: string;
  paymentExpiresAt?: string;
  hasPaymentAttempt: boolean;
  hasPaymentMethod: boolean;
};

export const isCustomerOrderVisible = (
  order: CustomerOrderVisibilityInput,
  now = Date.now()
) => {
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
