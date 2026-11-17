import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ origin: true, user: true, authError: false, rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => state.origin }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user ? { id: "synthetic-user" } : null }, error: state.authError ? {} : null }) },
  rpc: state.rpc
}) }));
vi.mock("@/lib/representative-resale", () => import("../../../../../lib/representative-resale"));
import { POST } from "./route";
const kitId = "a0100000-0000-4000-8000-000000000001";
const request = (body: unknown = { kitId }) => new NextRequest("https://curtiz.com.br/api/representatives/kits/preview", {
  method: "POST", headers: { origin: "https://curtiz.com.br", "content-type": "application/json" }, body: JSON.stringify(body)
});
beforeEach(() => { state.origin = true; state.user = true; state.authError = false; state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: { kitId, name: "Synthetic offer", merchandiseTotalInCents: 4345, items: [] }, error: null }); });
describe("authenticated resale preview boundary", () => {
  it("uses an existing catalog variant and the selected quantity without requiring a legacy offer", async () => {
    const response = await POST(request({ variantId: kitId, quantity: 3 }));
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("read_representative_catalog_kit_context", { p_variant_id: kitId, p_quantity: 3 });
  });
  it.each([0, 100, 1.5])("rejects invalid purchase quantity %s", async quantity => {
    expect((await POST(request({ variantId: kitId, quantity }))).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("returns a blocked private preview, never a B2C order or payment", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload: unknown = await response.json();
    expect(payload).toMatchObject({ purpose: "resale", finalConsumer: null, canPurchase: false, merchandiseTotalInCents: 4345 });
    expect(payload).toHaveProperty("blockers");
    expect(JSON.stringify(payload)).toContain("recipient_final_consumer_validation_required");
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("read_representative_resale_context", { p_kit_id: kitId });
  });
  it("rejects cross-origin requests before accessing the database", async () => {
    state.origin = false; expect((await POST(request())).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("marks the buyer's declaration as unverified without authorizing a purchase", async () => {
    const declaredScenario = { personType: "business", purpose: "resale", icmsStatus: "registration_exempt", destinationState: "MG" };
    const response = await POST(request({ kitId, declaredScenario }));
    const payload: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ declaredScenario: { ...declaredScenario, verification: "unverified" }, finalConsumer: null, canPurchase: false });
  });
  it.each([
    { personType: "business", purpose: "resale", icmsStatus: "taxpayer", destinationState: "XX" },
    { personType: "business", purpose: "resale", icmsStatus: "taxpayer", destinationState: "MG", approved: true },
    { personType: "individual", purpose: "resale", icmsStatus: "taxpayer", destinationState: "MG", cpf: "123" }
  ])("rejects malformed or extra fiscal scenario data", async declaredScenario => {
    expect((await POST(request({ kitId, declaredScenario }))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects combining the legacy taxpayer flag with a new scenario", async () => {
    const declaredScenario = { personType: "business", purpose: "resale", icmsStatus: "non_taxpayer", destinationState: "MG" };
    expect((await POST(request({ kitId, declaredScenario, icmsTaxpayer: true }))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(["final_consumption", "other"])("keeps a %s declaration blocked as a purpose mismatch", async purpose => {
    const declaredScenario = { personType: "individual", purpose, icmsStatus: "unknown", destinationState: "MG" };
    const response = await POST(request({ kitId, declaredScenario }));
    const payload: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ canPurchase: false, finalConsumer: null });
    expect(JSON.stringify(payload)).toContain("recipient_purpose_mismatch");
  });
  it.each([false, true])("requires a valid authenticated user (authError=%s)", authError => {
    state.user = authError; state.authError = authError;
    return POST(request()).then(response => { expect(response.status).toBe(401); expect(state.rpc).not.toHaveBeenCalled(); });
  });
  it.each([{ kitId, finalConsumer: true }, { kitId, totalInCents: 1 }, { kitId, icmsTaxpayer: "false" }, { kitId: "invalid" }])("rejects client totals, purpose overrides and malformed declarations", async body => {
    expect((await POST(request(body))).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("distinguishes unauthorized/unavailable kits from database failure and malformed context", async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: null }); expect((await POST(request())).status).toBe(404);
    state.rpc.mockResolvedValueOnce({ data: null, error: {} }); expect((await POST(request())).status).toBe(503);
    state.rpc.mockResolvedValueOnce({ data: { wrong: true }, error: null }); expect((await POST(request())).status).toBe(409);
  });
});
