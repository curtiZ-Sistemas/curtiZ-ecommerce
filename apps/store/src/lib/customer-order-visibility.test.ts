import { describe, expect, it } from "vitest";
import { isCustomerOrderVisible } from "./customer-order-visibility";

const now = Date.parse("2026-09-12T12:00:00.000Z");

describe("customer order visibility", () => {
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

  it("keeps approved and cancelled history visible", () => {
    for (const orderStatus of ["payment_approved", "cancelled"]) {
      expect(isCustomerOrderVisible({
        orderStatus,
        paymentStatus: orderStatus === "payment_approved" ? "approved" : "cancelled",
        paymentStatusDetail: orderStatus === "cancelled" ? "cancelled_by_customer" : "accredited",
        hasPaymentAttempt: true,
        hasPaymentMethod: true
      }, now)).toBe(true);
    }
  });
});
