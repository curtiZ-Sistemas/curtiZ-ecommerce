import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, DELETE } from "./route";
const state = vi.hoisted(() => ({ enabled: true, user: { id: "user-a" }, rate: true, save: vi.fn(), remove: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createServiceSupabaseClient: () => ({ rpc: async () => ({ data: state.rate, error: null }) }) }));
vi.mock("@/lib/mercadopago-saved-cards", () => ({ savedCardsEnabled: () => state.enabled, saveMyMercadoPagoCard: state.save,
  deleteMyMercadoPagoCard: state.remove, listMyMercadoPagoCards: state.list, SavedCardsError: class extends Error {} }));
const request = (method = "GET", body?: unknown, origin = "https://store.test") => new Request("https://store.test/api/customer/cards", {
  method, headers: { origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const input = { orderId: "11111111-1111-4111-8111-111111111111", key: "22222222-2222-4222-8222-222222222222", token: "fresh-token", consent: true };
beforeEach(() => { state.enabled = true; state.rate = true; state.user = { id: "user-a" }; state.save.mockReset(); state.remove.mockReset();
  state.list.mockReset().mockResolvedValue({ enabled: true, customerId: "owned-customer", cards: [] }); });
describe("API autenticada de cartões", () => {
  it("exige sessão", async () => { state.user = null as unknown as typeof state.user; expect((await GET(request())).status).toBe(401); });
  it("default false não consulta provider e não finge que salvou", async () => { state.enabled = false;
    expect(await (await GET(request())).json()).toMatchObject({ enabled: false }); expect((await POST(request("POST", input))).status).toBe(503);
    expect(state.save).not.toHaveBeenCalled(); expect(state.list).not.toHaveBeenCalled(); });
  it("opt-in desmarcado não salva", async () => { expect((await POST(request("POST", { ...input, consent: false }))).status).toBe(400); expect(state.save).not.toHaveBeenCalled(); });
  it("opt-in explícito encaminha somente token novo e IDs para o servidor", async () => {
    const response = await POST(request("POST", input)); expect(response.status).toBe(200);
    expect(state.save).toHaveBeenCalledWith(expect.anything(), state.user, input);
    expect(JSON.stringify(await response.json())).not.toContain(input.token); expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("recusa Customer arbitrário e dados extras brutos", async () => {
    expect((await POST(request("POST", { ...input, customerId: "customer-b" }))).status).toBe(400);
    expect(state.save).not.toHaveBeenCalled();
  });
  it("exclusão passa ownership ao helper e recusa origem externa", async () => {
    expect((await DELETE(request("DELETE", { cardId: "card-b" }, "https://evil.test"))).status).toBe(403);
    expect(state.remove).not.toHaveBeenCalled();
    expect((await DELETE(request("DELETE", { cardId: "card-a" }))).status).toBe(200);
    expect(state.remove).toHaveBeenCalledWith(expect.anything(), state.user, "card-a", expect.any(String));
  });
  it("rate limit bloqueia operações sem chamar provider", async () => { state.rate = false;
    expect((await POST(request("POST", input))).status).toBe(429); expect(state.save).not.toHaveBeenCalled(); });
});
