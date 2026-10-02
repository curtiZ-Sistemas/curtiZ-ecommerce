import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), exchange: vi.fn(), request: vi.fn(), complete: vi.fn() }));
vi.mock("@/lib/bling-server", () => ({ authorizeBlingTechnicalRequest: state.authorize,
  blingCallbackUrl: () => new URL("https://panel.example/api/integrations/bling/callback"), blingEnvironment: () => "sandbox",
  panelBlingClient: () => ({ exchangeCode: state.exchange, request: state.request, completeConnection: state.complete }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: () => ({ rpc: state.rpc,
  from: () => ({ insert: async () => ({ error: null }) }) }) }));
import { GET } from "./route";
const callback = (origin = "https://panel.example") => new NextRequest(`${origin}/api/integrations/bling/callback?code=test-code&state=${"a".repeat(43)}`);
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_PANEL_URL", "https://panel.example");
  state.authorize.mockReset().mockResolvedValue({ userId: "actor-test" });
  state.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === "consume_integration_oauth_state" ? "/tecnico/integracoes" : null, error: null }));
  state.exchange.mockReset().mockResolvedValue(undefined);
  state.request.mockReset().mockResolvedValue({ data: { id: "company-test", nome: "Company Test" } });
  state.complete.mockReset().mockResolvedValue(undefined);
});
describe("OAuth state and account activation", () => {
  it("rejects callback origin mismatch before exchanging a code", async () => {
    expect((await GET(callback("https://attacker.example"))).status).toBe(403);
    expect(state.exchange).not.toHaveBeenCalled();
  });
  it("blocks missing authorization/MFA and replayed or expired state", async () => {
    state.authorize.mockResolvedValue(null);
    expect((await GET(callback())).headers.get("location")).toContain("bling=error");
    expect(state.exchange).not.toHaveBeenCalled();
    state.authorize.mockResolvedValue({ userId: "actor-test" });
    state.rpc.mockResolvedValue({ data: null, error: null });
    expect((await GET(callback())).headers.get("location")).toContain("bling=error");
    expect(state.exchange).not.toHaveBeenCalled();
  });
  it("binds a hashed one-use state to actor/environment and verifies the account before storing tokens", async () => {
    expect((await GET(callback())).headers.get("location")).toContain("bling=connected");
    expect(state.rpc).toHaveBeenCalledWith("consume_integration_oauth_state", expect.objectContaining({
      p_actor_id: "actor-test", p_environment: "sandbox", p_provider: "bling", p_state_hash: expect.stringMatching(/^[0-9a-f]{64}$/u) as unknown }));
    expect(state.complete).toHaveBeenCalledOnce();
    expect(state.request.mock.invocationCallOrder[0]).toBeLessThan(state.complete.mock.invocationCallOrder[0]!);
  });
  it("never activates a different or unverified company", async () => {
    state.rpc.mockImplementation(async (name: string) => name === "save_bling_account" ? { data: null, error: new Error("company_mismatch") }
      : { data: "/tecnico/integracoes", error: null });
    expect((await GET(callback())).headers.get("location")).toContain("bling=error");
    expect(state.complete).not.toHaveBeenCalled();
  });
});
