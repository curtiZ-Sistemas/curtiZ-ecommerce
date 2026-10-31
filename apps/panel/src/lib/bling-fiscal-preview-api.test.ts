import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { BlingError } from "@curtiz/integrations";
const state = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), rpc: vi.fn(), selectRule: vi.fn(), mirror: vi.fn(), returnPreview: vi.fn() }));
vi.mock("@/lib/bling-return-preview", () => ({ buildArchivedBlingReturnPreview: state.returnPreview }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/bling-server", () => ({ authorizeBlingTechnicalRequest: state.auth }));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/technical-api", () => ({ safeTechnicalOrigin: state.origin, technicalNoStore: { "cache-control": "private, no-store" },
  unauthorizedTechnicalResponse: () => new Response(null, { status: 401 }) }));
vi.mock("@curtiz/integrations", () => ({ BlingError: class extends Error { constructor(public code: string, public status = 409) { super(code); } }, blingFiscalMirrorHash: vi.fn(),
  buildBlingOrderFiscalMirror: vi.fn(), selectBlingFiscalRule: state.selectRule,
  buildBlingFiscalMirror: state.mirror, expandBlingFiscalKit: vi.fn(() => []) }));
import { POST } from "../app/api/integrations/bling/fiscal-preview/route";
const input = { variantId: "a0200000-0000-4000-8000-000000000001", quantity: 1, destinationState: "SP",
  operation: "sale", icmsTaxpayer: true, finalConsumer: false, creditEligible: true, recipientIsCompany: true,
  saleDate: "2026-10-24", stateRegistrationActive: true, recipientTaxRegime: "normal", goodsPurpose: "resale" };
const request = (data: unknown) => new NextRequest("https://panel.example/api/integrations/bling/fiscal-preview", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
beforeEach(() => {
  vi.clearAllMocks(); state.auth.mockResolvedValue({ userId: "technical-test" }); state.origin.mockReturnValue(true);
  state.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "read_bling_fiscal_rules" ? []
    : { product: { name: "Synthetic pair" }, variant: { sku: "TEST-PAIR", price_override: 10 },
      metadata: { commercial_unit: "PR", pairs_per_sku: 1, ncm: "64022000", origin: 0 } } }));
  state.selectRule.mockReturnValue({}); state.mirror.mockReturnValue({ transmittable: false, consumesInvoiceNumber: false });
});
describe("technical fiscal preview recipient declarations", () => {
  const returnId = "a0200000-0000-4000-8000-000000000002";
  it("loads a return by server-side identity without accepting catalog prices or quantities", async () => {
    state.returnPreview.mockResolvedValue({ returnId, source: "authorized_invoice_archive", transmittable: false });
    const response = await POST(request({ returnId }));
    expect(response.status).toBe(200);
    expect(state.returnPreview).toHaveBeenCalledWith(expect.anything(), returnId);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ mirror: { returnId, transmittable: false } });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each([{ quantity: 2 }, { originalInvoiceKey: "1".repeat(44) }, { discountInCents: 0 }, { items: [] }])("rejects client supplied return context %j", patch => {
    return POST(request({ returnId, ...patch })).then(response => {
      expect(response.status).toBe(400); expect(state.returnPreview).not.toHaveBeenCalled();
    });
  });
  it("protects the archived return route before reading documents", async () => {
    state.auth.mockResolvedValue(null);
    expect((await POST(request({ returnId }))).status).toBe(401);
    expect(state.returnPreview).not.toHaveBeenCalled();
  });
  it("explains a missing original archive without leaking internal exceptions", async () => {
    state.returnPreview.mockRejectedValue(new BlingError("return_original_invoice_context_required", 409));
    const response = await POST(request({ returnId }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "return_original_invoice_context_required" });
  });
  it("distinguishes storage failure from missing fiscal data", async () => {
    state.returnPreview.mockRejectedValue(new BlingError("return_context_unavailable", 503));
    const response = await POST(request({ returnId }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "return_context_unavailable" });
  });
  it("does not let supplied credit eligibility bypass technical authorization", async () => {
    state.auth.mockResolvedValue(null);
    expect((await POST(request(input))).status).toBe(401); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects an unsafe origin before accessing the database", async () => {
    state.origin.mockReturnValue(false);
    expect((await POST(request(input))).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("passes the explicit recipient and credit declarations to the fiscal selector", async () => {
    const result = await POST(request(input));
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
    expect(state.selectRule).toHaveBeenCalledWith([], expect.objectContaining({ creditEligible: true, recipientIsCompany: true, finalConsumer: false,
      saleDate: "2026-10-24", stateRegistrationActive: true, recipientTaxRegime: "normal", goodsPurpose: "resale" }));
    expect(await result.json()).toMatchObject({ mirror: { transmittable: false, consumesInvoiceNumber: false } });
  });
  it("does not accept client supplied tax rates or series", async () => {
    expect((await POST(request({ ...input, icms_credit_rate: 1, series: 2 }))).status).toBe(400);
    expect(state.selectRule).not.toHaveBeenCalled();
  });
  it("rejects a supplied monthly approval or reviewed credit bases", async () => {
    for (const field of [{ credit_periods: [] }, { monthlyCredit: { rate: 1 } }, { icmsCreditBasesInCents: [100] }])
      expect((await POST(request({ ...input, ...field }))).status).toBe(400);
    expect(state.selectRule).not.toHaveBeenCalled();
  });
  it.each([undefined, "1".repeat(44)])("never substitutes catalog data for the original invoice even with key %s", async originalInvoiceKey => {
    const result = await POST(request({ ...input, operation: "return", icmsTaxpayer: false, finalConsumer: true,
      creditEligible: false, recipientIsCompany: false, originalInvoiceKey }));
    expect(result.status).toBe(409);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(await result.json()).toMatchObject({ code: "return_original_invoice_context_required" });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.selectRule).not.toHaveBeenCalled();
    expect(state.mirror).not.toHaveBeenCalled();
  });
  it.each(["fiscal_monthly_credit_required", "fiscal_credit_competence_required"])("explains the missing monthly information for %s", async code => {
    state.selectRule.mockImplementation(() => { throw new BlingError(code, 409); });
    const result = await POST(request(input));
    expect(result.status).toBe(409);
    const body: unknown = await result.json();
    expect(body).toMatchObject({ code });
    expect(body !== null && typeof body === "object" && "message" in body && typeof body.message === "string"
      && /competência|data da operação/u.test(body.message)).toBe(true);
  });
});

