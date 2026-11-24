import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ mfa: true, allowed: true, user: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/internal-mfa", () => ({ hasRequiredInternalMfa: async () => state.mfa }));
vi.mock("@/lib/technical-api", () => ({ technicalNoStore: { "cache-control": "private, no-store" } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user ? { id: "accountant" } : null }, error: null }) },
    rpc: async () => ({ data: state.allowed, error: null })
  })
}));
import { GET } from "../app/api/fiscal/cnpj/route";

const call = (cnpj: string) => GET(new NextRequest(`https://panel.example/api/fiscal/cnpj?cnpj=${cnpj}`));
const fetchMock = vi.fn();

beforeEach(() => { vi.stubGlobal("fetch", fetchMock); Object.assign(state, { mfa: true, allowed: true, user: true }); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe("consulta de CNPJ", () => {
  it("preenche razão social e endereço pela BrasilAPI, sem enviar dados do usuário", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      razao_social: "LOJA TESTE LTDA", descricao_situacao_cadastral: "ATIVA", uf: "MG", cep: "30110100",
      descricao_tipo_de_logradouro: "RUA", logradouro: "DOS TESTES", numero: "10", complemento: "SALA 2", bairro: "CENTRO", municipio: "BELO HORIZONTE"
    }), { status: 200 }));
    const response = await call("11.222.333/0001-81");
    expect(await response.json()).toEqual({
      found: true, name: "LOJA TESTE LTDA", status: "Ativa", active: true,
      address: { state: "MG", postal_code: "30110100", street: "Rua Dos Testes", number: "10", complement: "Sala 2", district: "Centro", city: "Belo Horizonte" }
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://brasilapi.com.br/api/cnpj/v1/11222333000181");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(init)).not.toMatch(/cookie|authorization/iu);
  });

  it("recusa CNPJ inválido sem consultar a Receita", async () => {
    expect((await call("11222333000182")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("diz que não achou quando o CNPJ não existe e cai no preenchimento manual quando a consulta falha", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    expect(await (await call("11222333000181")).json()).toMatchObject({ found: false });
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const failed = await call("11222333000181");
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { message: string }).message).toContain("manualmente");
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    expect((await call("11222333000181")).status).toBe(502);
  });

  it("só atende quem tem sessão com MFA e a permissão de emitir", async () => {
    state.allowed = false;
    expect((await call("11222333000181")).status).toBe(403);
    state.allowed = true; state.mfa = false;
    expect((await call("11222333000181")).status).toBe(403);
    state.mfa = true; state.user = false;
    expect((await call("11222333000181")).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
