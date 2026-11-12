import { describe, expect, it, vi } from "vitest";
import { attachManagerOrderProfits } from "./manager-order-profits";

describe("manager order profits", () => {
  it("attaches confirmed profits, including negative results", async () => {
    const read = vi.fn(async () => ({ data: [{ order_id: "one", estimated_profit: -2.5 }], error: null }));
    await expect(attachManagerOrderProfits([{ id: "one", public_code: "A" }], read))
      .resolves.toEqual([{ id: "one", public_code: "A", estimated_profit: -2.5 }]);
    expect(read).toHaveBeenCalledWith(["one"]);
  });
  it("fails closed for missing, invalid or unavailable profits", async () => {
    for (const result of [
      { data: [], error: null },
      { data: [{ order_id: "one", estimated_profit: null }], error: null },
      { data: null, error: { code: "42501" } }
    ]) await expect(attachManagerOrderProfits([{ id: "one" }], async () => result)).rejects.toThrow();
  });
  it("limits batches to 500 orders and skips empty lists", async () => {
    const read = vi.fn(async (ids: string[]) => ({ data: ids.map((id) => ({ order_id: id, estimated_profit: 0 })), error: null }));
    await expect(attachManagerOrderProfits([], read)).resolves.toEqual([]);
    expect(read).not.toHaveBeenCalled();
    await attachManagerOrderProfits(Array.from({ length: 501 }, (_, id) => ({ id: String(id) })), read);
    expect(read.mock.calls.map(([ids]) => ids.length)).toEqual([500, 1]);
  });
});
