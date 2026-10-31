import { describe, expect, it } from "vitest";
import { canTransitionOrder } from "./status";
describe("pre-shipment cancellation transitions", () => {
  it("unpaid orders cancel directly", () => expect(canTransitionOrder("pending_payment","cancelled")).toBe(true));
  it.each(["payment_approved", "processing", "picking", "ready_to_ship"] as const)("%s can enter refund hold", status => expect(canTransitionOrder(status,"refund_pending")).toBe(true));
  it.each(["shipped", "delivered", "refund_pending", "cancellation_requested"] as const)("%s cannot reenter dispatch preparation", status => expect(canTransitionOrder(status,"ready_to_ship")).toBe(false));
});
