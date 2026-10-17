import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as Integrations from "@curtiz/integrations";
const state = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), run: vi.fn(), audit: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/integrations", async (original) => ({ ...await original<typeof Integrations>(), runBlingCatalogBatch: state.run }));
vi.mock("@/lib/bling-server", () => ({ authorizeBlingTechnicalRequest: state.auth }));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: () => ({ rpc: state.rpc, from: () => ({ insert: state.audit }) }) }));
vi.mock("@/lib/technical-api", () => ({ safeTechnicalOrigin: state.origin, technicalNoStore: { "cache-control": "private, no-store" },
  unauthorizedTechnicalResponse: () => new Response(null, { status: 401 }) }));
import { POST } from "../app/api/integrations/bling/catalog/run/route";
const request = (body: unknown) => new NextRequest("https://panel.example/api/integrations/bling/catalog/run", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://panel.example" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); state.origin.mockReturnValue(true); state.auth.mockResolvedValue({ userId: "technical-test" });
  state.run.mockResolvedValue({ ok: true, processed: 4, failed: 0, errors: [] }); state.audit.mockResolvedValue({ error: null });
});
describe("authenticated manual catalogue batches", () => {
  it("rejects cross-origin writes before authentication or processing", async () => {
    state.origin.mockReturnValue(false);
    expect((await POST(request({ limit: 4 }))).status).toBe(403);
    expect(state.auth).not.toHaveBeenCalled(); expect(state.run).not.toHaveBeenCalled();
  });
  it("requires the existing active technical session, permission and MFA authorizer", async () => {
    state.auth.mockResolvedValue(null);
    expect((await POST(request({ limit: 4 }))).status).toBe(401); expect(state.run).not.toHaveBeenCalled();
  });
  it.each([0, 9, 2.5, "8"])("rejects invalid batch size %s", async (limit) => {
    expect((await POST(request({ limit }))).status).toBe(400); expect(state.run).not.toHaveBeenCalled();
  });
  it("runs a bounded batch and records the real result under the actor", async () => {
    const result = await POST(request({ limit: 4 }));
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ processed: 4 });
    expect(state.run.mock.calls[0]?.[2]).toBe(4);
    expect(state.audit.mock.calls[0]?.[0]).toMatchObject({ actor_id: "technical-test", action: "integration.bling.catalog_batch" });
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not expose raw provider messages on failure", async () => {
    state.run.mockRejectedValue(new Error("private provider detail"));
    const result = await POST(request({ limit: 4 }));
    expect(result.status).toBe(503); expect(await result.text()).not.toContain("private provider detail");
  });
});
