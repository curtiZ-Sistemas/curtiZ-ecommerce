import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MercadoPagoProviderError, MercadoPagoTestPaymentProvider } from "./index";

afterEach(() => vi.unstubAllGlobals());
describe("Mercado Pago sanitized rejection diagnostics", () => {
  it("retains the provider request ID separately from the local correlation without copying response data", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      cause: [{ code: 10111, description: "Invalid issuer private-token-value" }]
    }, { status: 400, headers: { "x-request-id": "11111111-2222-4333-8444-555555555555" } })));
    const issue: unknown = await new MercadoPagoTestPaymentProvider("TEST-fixture").getPayment("123").catch((error: unknown) => error);
    expect(issue).toMatchObject({ providerCauseCodes: ["10111"], providerRejectionFields: ["issuer", "token"],
      providerRequestId: "11111111-2222-4333-8444-555555555555" });
    expect(JSON.stringify(issue)).not.toContain("private-token-value");
  });
  it.each([undefined, null, "", "x".repeat(101), "private@example.com", "id\nsecret", "id?token=secret"])(
    "discards an absent or malformed provider request ID: %s", providerRequestId => {
      expect(new MercadoPagoProviderError("payment_rejected", 400, [], [], providerRequestId).providerRequestId).toBeNull();
    });
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
  it("classifies only fixed field names and never copies provider text or values", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      message: "Invalid payer email fixture@example.com", cause: [{ code: 10113, description: "card token private-fixture-value" }]
    }, { status: 400 })));
    const issue: unknown = await new MercadoPagoTestPaymentProvider("TEST-fixture").getPayment("123").catch((error: unknown) => error);
    expect(issue).toMatchObject({ providerRejectionFields: ["payer", "email", "token", "card"] });
    expect(JSON.stringify(issue)).not.toContain("fixture@example.com");
    expect(JSON.stringify(issue)).not.toContain("private-fixture-value");
  });
});
