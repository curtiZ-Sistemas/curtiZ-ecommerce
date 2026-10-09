import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  authorized: true, readCredential: vi.fn(), upsert: vi.fn(), readStoreHealth: vi.fn(), health: vi.fn()
}));
vi.mock("@/lib/technical-api", () => ({
  authorizeTechnicalRequest: () => mocks.authorized ? { userId: "technical-user" } : null,
  technicalNoStore: { "cache-control": "private, no-store" },
  unauthorizedTechnicalResponse: () => Response.json({ message: "Acesso negado" }, { status: 403 })
}));
vi.mock("@/lib/melhor-envio-server", () => ({
  melhorEnvioEnvironment: () => "sandbox", melhorEnvioOriginMissingFields: () => [],
  panelMelhorEnvioProvider: () => ({ health: mocks.health })
}));
vi.mock("@/lib/store-shipping-health", () => vi.importActual("../../../../../lib/store-shipping-health"));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: () => ({
  rpc: mocks.readCredential,
  from: () => ({ upsert: mocks.upsert, select: () => ({ eq: () => ({ maybeSingle: mocks.readStoreHealth }) }) })
}) }));

describe("status OAuth do painel e diagnóstico da loja", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorized = true;
    mocks.readCredential.mockResolvedValue({ data: { status: "connected", access_token_ciphertext: "private-ciphertext" }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.health.mockResolvedValue("online");
    mocks.readStoreHealth.mockResolvedValue({ data: { provider: "melhorenvio_store", state: "offline",
      error_summary: "melhor_envio_authentication", metadata_sanitized: { environment: "sandbox", reason: "token_decryption_failed" }
    }, error: null });
  });

  it("nega acesso antes de consultar credenciais ou saúde", async () => {
    mocks.authorized = false;
    expect((await GET(new NextRequest("https://panel.example.com/api/integrations/melhor-envio/status"))).status).toBe(403);
    expect(mocks.readCredential).not.toHaveBeenCalled();
    expect(mocks.readStoreHealth).not.toHaveBeenCalled();
  });

  it("OAuth online não substitui o erro de autenticação da loja", async () => {
    const response = await GET(new NextRequest("https://panel.example.com/api/integrations/melhor-envio/status"));
    const body: unknown = await response.json();
    expect(body).toMatchObject({ connected: true, health: "online", storeShipping: {
      state: "offline", detail: expect.stringContaining("chave compartilhada entre loja e painel") as unknown
    } });
    expect(JSON.stringify(body)).not.toContain("private-ciphertext");
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ provider: "melhorenvio",
      metadata_sanitized: expect.objectContaining({ scope: "panel_oauth" }) as unknown
    }), { onConflict: "provider" });
  });

  it("falha na consulta da loja é exibida independentemente do OAuth", async () => {
    mocks.readStoreHealth.mockResolvedValue({ data: null, error: { code: "42501" } });
    const response = await GET(new NextRequest("https://panel.example.com/api/integrations/melhor-envio/status"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ health: "online", storeShipping: { state: "unavailable" } });
  });
});
