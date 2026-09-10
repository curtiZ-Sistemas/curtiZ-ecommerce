import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted((): { user: { id: string; email: string } | null; roles: { role: string }[]; passwordError: boolean; rateAllowed: boolean; cleanupError: boolean; authError: boolean; cleanup: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } => ({ user: { id: "customer", email: "test@example.invalid" },
  roles: [{ role: "customer" }], passwordError: false, rateAllowed: true, cleanupError: false, authError: false,
  cleanup: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: (request: Request) => request.headers.get("origin") !== "https://evil.invalid" }));
vi.mock("@/lib/auth-rate-limit", () => ({ enforceAuthRateLimit: async () => state.rateAllowed }));
vi.mock("@/lib/account-deletion-token", () => import("./account-deletion-token"));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }), signOut: async () => ({ error: null }) } }),
  createPublicSupabaseClient: () => ({ auth: { signInWithPassword: async () => ({ data: { user: state.user }, error: state.passwordError ? {} : null }), signOut: async () => ({ error: null }) } }),
  createServiceSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: state.roles, error: null }) }) }),
    rpc: state.cleanup, auth: { admin: { deleteUser: state.remove } } })
}));
import { POST } from "../app/api/customer/delete-account/route";
const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/customer/delete-account", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-only-key");
  state.user = { id: "customer", email: "test@example.invalid" }; state.roles = [{ role: "customer" }];
  state.passwordError = false; state.rateAllowed = true;
  state.cleanup.mockReset().mockResolvedValue({ error: null }); state.remove.mockReset().mockResolvedValue({ error: null });
});
describe("exclusão de conta no servidor", () => {
  it("rejeita origem externa, ausência de sessão e conta interna", async () => {
    expect((await POST(request({ action: "verify", password: "password" }, "https://evil.invalid"))).status).toBe(403);
    state.user = null;
    expect((await POST(request({ action: "verify", password: "password" }))).status).toBe(401);
    state.user = { id: "admin", email: "test@example.invalid" }; state.roles = [{ role: "admin" }];
    expect((await POST(request({ action: "verify", password: "password" }))).status).toBe(403);
    expect(state.cleanup).not.toHaveBeenCalled();
  });
  it("senha errada e limite excedido não autorizam exclusão", async () => {
    state.passwordError = true;
    expect((await POST(request({ action: "verify", password: "wrong" }))).status).toBe(403);
    state.rateAllowed = false;
    expect((await POST(request({ action: "verify", password: "wrong" }))).status).toBe(429);
    expect(state.remove).not.toHaveBeenCalled();
  });
  it("exige confirmação assinada e só exclui o usuário autenticado", async () => {
    const verified = await POST(request({ action: "verify", password: "password" }));
    const { token } = await verified.json() as { token: string };
    expect(state.cleanup).not.toHaveBeenCalled();
    expect((await POST(request({ action: "confirm", confirmed: true, token: "invalid" }))).status).toBe(403);
    expect((await POST(request({ action: "confirm", confirmed: true, token }))).status).toBe(200);
    expect(state.cleanup).toHaveBeenCalledWith("close_customer_account", { p_user_id: "customer" });
    expect(state.remove).toHaveBeenCalledWith("customer", true);
  });
  it("não anuncia sucesso quando limpeza ou autenticação falham", async () => {
    const { token } = await (await POST(request({ action: "verify", password: "password" }))).json() as { token: string };
    state.cleanup.mockResolvedValueOnce({ error: {} });
    expect((await POST(request({ action: "confirm", confirmed: true, token }))).status).toBe(503);
    expect(state.remove).not.toHaveBeenCalled();
    state.remove.mockResolvedValueOnce({ error: {} });
    expect((await POST(request({ action: "confirm", confirmed: true, token }))).status).toBe(503);
  });
});
