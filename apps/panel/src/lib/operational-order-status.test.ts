import { describe, expect, it } from "vitest";
import { isOperationallyActiveOrder } from "./operational-order-status";

describe("operational order status", () => {
  it.each(["cancelled", "refunded"])("keeps %s out of active queues", (status) => {
    expect(isOperationallyActiveOrder(status)).toBe(false);
  });

  it.each(["payment_approved", "processing", "picking", "ready_to_ship"])(
    "keeps %s in active queues",
    (status) => {
      expect(isOperationallyActiveOrder(status)).toBe(true);
    }
  );
});
