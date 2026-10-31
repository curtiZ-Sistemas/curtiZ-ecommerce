import { afterEach, describe, expect, it, vi } from "vitest";
import { readShippingPostalCode, rememberShippingPostalCode } from "./shipping-postal-code";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("temporary shipping postal code", () => {
  it("keeps only a CEP in session storage and expires it after 30 minutes", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { setItem: (key: string, value: string) => store.set(key, value),
      getItem: (key: string) => store.get(key), removeItem: (key: string) => store.delete(key) });
    const time = vi.spyOn(Date, "now").mockReturnValue(1000);
    rememberShippingPostalCode("01310-100");
    expect(readShippingPostalCode()).toBe("01310100");
    expect([...store.values()][0]).toBe('{"postalCode":"01310100","until":1801000}');
    time.mockReturnValue(1801001);
    expect(readShippingPostalCode()).toBe(""); expect(store.size).toBe(0);
  });
  it("handles unavailable and malformed storage without disrupting checkout", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => "invalid json", setItem: () => { throw new Error(); } });
    expect(readShippingPostalCode()).toBe("");
    expect(() => rememberShippingPostalCode("01310100")).not.toThrow();
  });
});
