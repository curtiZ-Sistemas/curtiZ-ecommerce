import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted((): {
  client: ReturnType<typeof vi.fn>; getUser: ReturnType<typeof vi.fn>;
  assurance: ReturnType<typeof vi.fn>; roles: string[]; status: string;
  profileError: unknown; origin: string;
} => ({
  client: vi.fn(), getUser: vi.fn(), assurance: vi.fn(), roles: ["admin"],
  status: "active", profileError: null, origin: "https://painel.curtiz.com.br"
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ host: new URL(state.origin).host })
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("./supabase/server", () => ({ createServerSupabaseClient: state.client }));

import { requirePanelAccess, requirePanelSelectionAccess } from "./auth";

beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("REQUIRE_INTERNAL_MFA", "false");
  vi.stubEnv("NEXT_PUBLIC_STORE_URL", "https://curtiz-ecommerce.sistemas-curtiz.workers.dev");
  vi.stubEnv("NEXT_PUBLIC_PANEL_URL", "https://curtiz-painel.sistemas-curtiz.workers.dev");
  vi.stubEnv("NEXT_PUBLIC_STORE_TEST_URL", "https://curtiz-ecommerce.sistemas-curtiz.workers.dev");
  vi.stubEnv("NEXT_PUBLIC_PANEL_TEST_URL", "https://curtiz-painel.sistemas-curtiz.workers.dev");
  state.origin = "https://painel.curtiz.com.br";
  state.roles = ["admin"];
  state.status = "active";
  state.profileError = null;
  state.getUser.mockReset().mockResolvedValue({ data: { user: { id: "test-user" } }, error: null });
  state.assurance.mockReset().mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
  state.client.mockReset().mockResolvedValue({
    auth: { getUser: state.getUser, mfa: { getAuthenticatorAssuranceLevel: state.assurance } },
    from: (table: string) => ({ select: () => ({ eq: () => table === "profiles"
      ? { maybeSingle: async () => ({ data: { status: state.status, full_name: "Test" }, error: state.profileError }) }
      : Promise.resolve({ data: state.roles.map(role => ({ role })), error: null }) }) })
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("acesso ao painel após o login", () => {
  it("aceita o administrador com sessão validada sem redirecionar ao login", async () => {
    expect(await requirePanelAccess("administracao", "/administracao")).toMatchObject({
      userId: "test-user", roles: ["admin"], demo: false
    });
    expect(state.getUser).toHaveBeenCalledOnce();
  });
  it("oferece todos os painéis efetivamente autorizados, incluindo técnico", async () => {
    state.roles = ["admin", "manager", "technical"];
    expect((await requirePanelSelectionAccess()).panels.map(p => p.href)).toEqual([
      "/administracao", "/gerencia", "/tecnico"
    ]);
  });
  it.each(["administracao", "selecionar-painel"])("informa sessão ausente em %s no login oficial", async path => {
    state.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    const action = path === "selecionar-painel" ? requirePanelSelectionAccess()
      : requirePanelAccess("administracao", "/administracao");
    await expect(action).rejects.toThrow(`redirect:https://curtiz.com.br/login?next=%2F${path}&reason=session_expired`);
  });
  it("informa indisponibilidade sem expor a exceção do provedor", async () => {
    state.getUser.mockRejectedValue(new Error("sensitive-provider-error"));
    await expect(requirePanelSelectionAccess()).rejects.toThrow(
      "redirect:https://curtiz.com.br/login?next=%2Fselecionar-painel&reason=session_unavailable"
    );
  });
  it("trata cliente não configurado como indisponibilidade", async () => {
    state.client.mockResolvedValue(null);
    await expect(requirePanelSelectionAccess()).rejects.toThrow("reason=session_unavailable");
  });
  it("mantém o retorno ao login dentro do par workers.dev", async () => {
    state.origin = "https://curtiz-painel.sistemas-curtiz.workers.dev";
    state.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requirePanelSelectionAccess()).rejects.toThrow(
      "redirect:https://curtiz-ecommerce.sistemas-curtiz.workers.dev/login?next=%2Fselecionar-painel&reason=session_expired"
    );
  });
  it("continua exigindo MFA sem perder o destino oficial", async () => {
    vi.stubEnv("REQUIRE_INTERNAL_MFA", "true");
    state.roles = ["admin", "technical"];
    state.assurance.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
    await expect(requirePanelSelectionAccess()).rejects.toThrow(
      "redirect:https://curtiz.com.br/mfa?next=https%3A%2F%2Fpainel.curtiz.com.br%2Fselecionar-painel"
    );
  });
  it.each(["customer", "representative"])("não concede acesso interno a %s", async role => {
    state.roles = [role];
    await expect(requirePanelAccess("administracao", "/administracao")).rejects.toThrow("redirect:https://curtiz.com.br/403");
  });
  it("não transforma falha na leitura das permissões em autorização", async () => {
    state.profileError = { message: "database-unavailable" };
    await expect(requirePanelSelectionAccess()).rejects.toThrow("redirect:https://curtiz.com.br/403");
  });
});
