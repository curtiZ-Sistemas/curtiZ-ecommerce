import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MercadoPagoProviderError, MercadoPagoTestPaymentProvider } from "./index";

afterEach(() => vi.unstubAllGlobals());
describe("Mercado Pago sanitized rejection diagnostics", () => {
  it("retains only bounded numeric cause codes, without provider descriptions or credentials", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      message: "private fixture text", cause: [{ code: 2006, description: "private fixture text" },
        { code: "150", description: "private fixture text" }, { code: "fixture-secret" }, { code: {} }]
    }, { status: 400 })));
    const error: unknown = await new MercadoPagoTestPaymentProvider("TEST-fixture").getPayment("123").catch((issue: unknown) => issue);
    expect(error).toBeInstanceOf(MercadoPagoProviderError);
    expect(error).toMatchObject({ code: "payment_rejected", httpStatus: 400, providerCauseCodes: ["2006", "150"] });
    expect(JSON.stringify(error)).not.toContain("private fixture text");
    expect(JSON.stringify(error)).not.toContain("fixture-secret");
  });
  it("limits diagnostics and preserves upstream failure classification", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      cause: Array.from({ length: 20 }, (_, index) => ({ code: index }))
    }, { status: 503 })));
    await expect(new MercadoPagoTestPaymentProvider("TEST-fixture").getPayment("123"))
      .rejects.toMatchObject({ code: "provider_unavailable", httpStatus: 503, providerCauseCodes: ["0", "1", "2", "3", "4"] });
  });
});
