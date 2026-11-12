import { describe, expect, it, vi } from "vitest";
import { readOperationalShipmentCosts } from "./operational-shipment-costs";

describe("operational shipment costs", () => {
  it("returns verified costs and preserves an unknown cost", async () => {
    const read = vi.fn(async () => ({ data: [{ shipment_id: "one", shipping_cost: 4.5 }, { shipment_id: "two", shipping_cost: null }], error: null }));
    const result = await readOperationalShipmentCosts(["one", "two", "one"], read);
    expect([...result]).toEqual([["one", 4.5], ["two", null]]);
    expect(read).toHaveBeenCalledWith(["one", "two"]);
  });
  it("fails closed when the protected reader fails or omits a cost", async () => {
    await expect(readOperationalShipmentCosts(["one"], async () => ({ data: [], error: null }))).rejects.toThrow();
    await expect(readOperationalShipmentCosts(["one"], async () => ({ data: null, error: { code: "42501" } }))).rejects.toThrow();
    await expect(readOperationalShipmentCosts(["one"], async () => ({ data: [{ shipment_id: "one", shipping_cost: -1 }], error: null }))).rejects.toThrow();
  });
  it("batches requests and avoids calls for an empty list", async () => {
    const read = vi.fn(async (ids: string[]) => ({ data: ids.map((id) => ({ shipment_id: id, shipping_cost: 1 })), error: null }));
    expect((await readOperationalShipmentCosts([], read)).size).toBe(0);
    expect(read).not.toHaveBeenCalled();
    await readOperationalShipmentCosts(Array.from({ length: 501 }, (_, i) => String(i)), read);
    expect(read.mock.calls.map(([ids]) => ids.length)).toEqual([500, 1]);
  });
});
