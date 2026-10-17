import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ auth: vi.fn(), request: vi.fn(), local: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/bling-server", () => ({ authorizeBlingTechnicalRequest: state.auth, panelBlingClient: () => ({ request: state.request }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: () => ({ from: () => ({ select: () => ({ in: state.local }) }) }) }));
vi.mock("@/lib/technical-api", () => ({ technicalNoStore: { "cache-control": "private, no-store" }, unauthorizedTechnicalResponse: () => new Response(null, { status: 401 }) }));
import { GET } from "../app/api/integrations/bling/readiness/route";
const request = (query: string) => new NextRequest(`https://panel.example/api/integrations/bling/readiness?${query}`);
type Report = { rows: Array<Record<string, unknown>> };
beforeEach(() => {
  vi.clearAllMocks(); state.auth.mockResolvedValue({ userId: "test" }); vi.stubEnv("BLING_STOCK_DEPOSIT_ID", "101");
  state.local.mockResolvedValue({ error: null, data: [{ id: "local", sku: "SKU-1", active: true, price_override: null,
    products: { base_price: 23.9, status: "active" }, inventory: [{ available_quantity: 44, reserved_quantity: 6 }] }] });
  state.request.mockImplementation(async (path: string) => ({ data: path.startsWith("/produtos")
    ? [{ id: 201, codigo: "SKU-1", preco: 23.9, situacao: "A" }] : [{ produto: { id: 201 }, saldoFisicoTotal: 50 }] }));
});
describe("read-only provider readiness evidence", () => {
  it("requires technical authorization before reading external data", async () => {
    state.auth.mockResolvedValue(null);
    expect((await GET(request("scope=catalog"))).status).toBe(401); expect(state.request).not.toHaveBeenCalled();
  });
  it.each(["scope=anything", "scope=catalog&page=0", "scope=series&series=0", "scope=series&series=1000"])("rejects invalid input %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400); expect(state.request).not.toHaveBeenCalled();
  });
  it("compares physical stock including reservations without subtracting them twice", async () => {
    const response = await GET(request("scope=catalog")); const body = await response.json() as Report;
    expect(response.status).toBe(200); expect(body.rows).toEqual([expect.objectContaining({ localPhysical: 50, localAvailable: 44,
      localReserved: 6, externalPhysical: 50, stockMatches: true, priceMatches: true, statusMatches: true, duplicate: false })]);
    expect(state.request.mock.calls.every((call) => call.length === 1)).toBe(true);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not turn an absent depot balance into a successful zero balance", async () => {
    state.request.mockImplementation(async (path: string) => ({ data: path.startsWith("/produtos") ? [{ id: 201, codigo: "SKU-1", preco: 23.9, situacao: "A" }] : [] }));
    const body = await (await GET(request("scope=catalog"))).json() as Report;
    expect(body.rows[0]).toMatchObject({ externalPhysical: null, stockMatches: false });
  });
  it("flags duplicate provider SKUs", async () => {
    state.request.mockImplementation(async (path: string) => ({ data: path.startsWith("/produtos") ? [201, 202].map((id) => ({ id, codigo: "SKU-1", preco: 23.9, situacao: "A" })) : [] }));
    const body = await (await GET(request("scope=catalog"))).json() as Report;
    expect(body.rows.every((r) => r.duplicate === true)).toBe(true);
  });
  it("checks both directions and cancelled documents before considering a series unused", async () => {
    state.request.mockImplementation(async (path: string) => ({ data: path.includes("tipo=0") && path.includes("situacao=2") ? [{ id: 100, numero: "1" }] : [] }));
    const response = await GET(request("scope=series&series=3"));
    expect(await response.json()).toMatchObject({ series: 3, used: true, includesCancelled: true, includesBothDirections: true, numberingChanged: false });
    expect(state.request).toHaveBeenCalledTimes(4);
  });
  it("does not report an unused series when a provider request fails", async () => {
    state.request.mockRejectedValue(new Error("private provider detail"));
    const response = await GET(request("scope=series&series=2"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private provider detail");
  });
});
