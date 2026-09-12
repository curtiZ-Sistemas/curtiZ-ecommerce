import { isUnknownRecord } from "./unknown-data";

export function normalizeOptionalCouponCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

export function isCancelledOrderStatus(status: string): boolean {
  return status === "cancellation_requested" || status === "cancelled";
}

export function shouldResumePendingCheckout(order: unknown, totals: unknown): boolean {
  return isUnknownRecord(order)
    && order.reused === true
    && isUnknownRecord(totals)
    && totals.status === "pending_payment"
    && totals.payment_status === "pending";
}
