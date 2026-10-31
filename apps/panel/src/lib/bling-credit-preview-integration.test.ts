import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/bling-server", () => ({ authorizeBlingTechnicalRequest: state.auth }));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/bling-return-preview", () => ({ buildArchivedBlingReturnPreview: vi.fn() }));
vi.mock("@/lib/technical-api", () => ({ safeTechnicalOrigin: () => true, technicalNoStore: { "cache-control": "private, no-store" },
  unauthorizedTechnicalResponse: () => new Response(null, { status: 401 }) }));
import { POST } from "../app/api/integrations/bling/fiscal-preview/route";

const period = { application_month: "2026-10-01", reference_month: "2026-09-01", rate: "1.3600", revision: 1,
  evidence_reference: "Synthetic accounting approval", approved_by: "10000000-0000-4000-8000-000000000001", approved_at: "2026-10-01T12:00:00Z" };
const rule = { scenario: "resale_in_state_credit", issuer_state: "MG", cfop: "5102", csosn: "101", icms_rate: 0,
  document_model: 55, series: 2, pis_cst: "49", cofins_cst: "49", ipi_cst: "99", pis_rate: 0, cofins_rate: 0,
  ipi_rate: 0, ipi_cenq: "999", credit_periods: [period], natures: [{ final_consumer: false, external_nature_id: 123 }] };
const input = { variantId: "a0200000-0000-4000-8000-000000000001", quantity: 1, destinationState: "MG", operation: "sale",
  icmsTaxpayer: true, finalConsumer: false, creditEligible: true, recipientIsCompany: true, saleDate: "2026-10-24",
  stateRegistrationActive: true, recipientTaxRegime: "normal", goodsPurpose: "resale" };
const request = (data: unknown) => new NextRequest("https://panel.example/api/integrations/bling/fiscal-preview", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

beforeEach(() => {
  vi.clearAllMocks();
  state.auth.mockResolvedValue({ userId: "technical-test" });
  state.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "read_bling_fiscal_rules" ? [rule] : {
    product: { name: "Synthetic pair" }, variant: { sku: "TEST-PAIR", price_override: 10 },
    metadata: { commercial_unit: "PR", pairs_per_sku: 1, fiscal_unit_approved: true, ncm: "64022000", origin: 0 }
  } }));
});

describe("CSOSN 101 preview using the real fiscal selector", () => {
  it("returns the approved month but keeps unverified bases, buyer and date blocked", async () => {
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("mirror" in body) || !body.mirror || typeof body.mirror !== "object")
      throw new Error("missing_fiscal_mirror");
    const mirror = body.mirror;
    expect(mirror).toMatchObject({ transmittable: false, consumesInvoiceNumber: false,
      rule: { csosn: "101", monthlyCredit: { rate: 1.36, applicationMonth: "2026-10-01" } } });
    if (!("blockers" in mirror)) throw new Error("missing_fiscal_blockers");
    expect(mirror.blockers).toEqual(expect.arrayContaining(["fiscal_credit_base_required",
      "fiscal_credit_recipient_evidence_required", "fiscal_credit_operation_date_evidence_required"]));
    expect(mirror).not.toHaveProperty("icmsCredit");
  });
  it("refuses the October rate for November", async () => {
    const response = await POST(request({ ...input, saleDate: "2026-11-01" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "fiscal_monthly_credit_required" });
  });
  it("does not treat a false state registration declaration as eligibility", async () => {
    const response = await POST(request({ ...input, stateRegistrationActive: false }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "fiscal_credit_recipient_required" });
  });
  it("does not accept fiscal bases from the caller", async () => {
    const response = await POST(request({ ...input, icmsCreditBasesInCents: [1000] }));
    expect(response.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("requires technical authorization before reading fiscal data", async () => {
    state.auth.mockResolvedValue(null);
    expect((await POST(request(input))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
