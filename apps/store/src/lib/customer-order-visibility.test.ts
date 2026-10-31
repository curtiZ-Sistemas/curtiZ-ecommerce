import { describe, expect, it } from "vitest";
import { isCustomerOrderVisible } from "./customer-order-visibility";

const now = Date.parse("2026-09-12T12:00:00.000Z");

describe("customer order visibility", () => {
  it.each(["draft", "cancellation_requested", "pending_payment"])("hides %s without any payment attempt", (orderStatus) => {
    expect(isCustomerOrderVisible({ orderStatus, paymentStatus: "pending", paymentStatusDetail: "",
      hasPaymentAttempt: false, hasPaymentMethod: true }, now)).toBe(false);
  });
  it("hides a pending checkout without a real payment attempt", () => {
    expect(isCustomerOrderVisible({
      orderStatus: "pending_payment",
      paymentStatus: "pending",
      paymentStatusDetail: "",
      hasPaymentAttempt: false,
      hasPaymentMethod: true
    }, now)).toBe(false);
  });

  it("shows a pending Pix order after the provider attempt starts", () => {
    expect(isCustomerOrderVisible({
      orderStatus: "pending_payment",
      paymentStatus: "pending",
      paymentStatusDetail: "pending_waiting_transfer",
      paymentExpiresAt: "2026-09-12T12:30:00.000Z",
      hasPaymentAttempt: true,
      hasPaymentMethod: true
    }, now)).toBe(true);
  });

  it.each([
    ["pending", "", "2026-09-12T11:59:59.000Z"],
    ["rejected", "cc_rejected_other_reason", "2026-09-12T11:59:59.000Z"],
    ["cancelled", "expired", "2026-09-12T12:30:00.000Z"]
  ])("hides an expired unpaid order (%s)", (paymentStatus, detail, expiresAt) => {
    expect(isCustomerOrderVisible({
      orderStatus: "pending_payment",
      paymentStatus,
      paymentStatusDetail: detail,
      paymentExpiresAt: expiresAt,
      hasPaymentAttempt: true,
      hasPaymentMethod: true
    }, now)).toBe(false);
  });

  it("keeps approved order history visible", () => {
    expect(isCustomerOrderVisible({
      orderStatus: "payment_approved",
      paymentStatus: "approved",
      paymentStatusDetail: "accredited",
      hasPaymentAttempt: true,
      hasPaymentMethod: true
    }, now)).toBe(true);
  });

  it("retains an unpaid cancellation until, but not including, three complete days", () => {
    const cancellationCompletedAt = "2026-09-09T12:00:00.000Z";
    const input = {
      orderStatus: "cancelled",
      paymentStatus: "cancelled",
      paymentStatusDetail: "cancelled_by_customer",
      cancellationCompletedAt,
      hasPaymentAttempt: false,
      hasPaymentMethod: false
    };

    expect(isCustomerOrderVisible(input, Date.parse("2026-09-12T11:59:00.000Z"))).toBe(true);
    expect(isCustomerOrderVisible(input, Date.parse("2026-09-12T12:00:00.000Z"))).toBe(false);
  });

  it("keeps pending, failed and manual-review refunds visible without a time limit", () => {
    for (const refundStatus of ["pending", "failed", "manual_review"]) {
      expect(isCustomerOrderVisible({
        orderStatus: refundStatus === "manual_review" ? "manual_review" : "refund_pending",
        paymentStatus: "approved",
        paymentStatusDetail: "accredited",
        refundStatus,
        refundCompletedAt: "2026-08-23T12:00:00.000Z",
        hasPaymentAttempt: true,
        hasPaymentMethod: true
      }, now)).toBe(true);
    }
  });

  it("retains a completed refund until, but not including, ten complete days", () => {
    const input = {
      orderStatus: "refunded",
      paymentStatus: "refunded",
      paymentStatusDetail: "refunded",
      refundStatus: "completed",
      refundCompletedAt: "2026-09-02T12:00:00.000Z",
      hasPaymentAttempt: true,
      hasPaymentMethod: true
    };

    expect(isCustomerOrderVisible(input, Date.parse("2026-09-12T11:59:00.000Z"))).toBe(true);
    expect(isCustomerOrderVisible(input, Date.parse("2026-09-12T12:00:00.000Z"))).toBe(false);
  });
});
