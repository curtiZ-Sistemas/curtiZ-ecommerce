import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptMelhorEnvioToken, melhorEnvioTokenKeyId } from "@curtiz/integrations";
import { GET } from "./route";

vi.mock("server-only", () => ({}));
const activeKey = Buffer.alloc(32, 5).toString("base64");
const previousKey = Buffer.alloc(32, 6).toString("base64");

const mocks = vi.hoisted(() => ({
  authorized: true, invalidEnvironment: false, readCredential: vi.fn(), upsert: vi.fn(), readStoreHealth: vi.fn(), health: vi.fn(),
  keyring: { activeKey: "", previousKeys: [] as string[] }
}));
vi.mock("@/lib/technical-api", () => ({
  authorizeTechnicalRequest: () => mocks.authorized ? { userId: "technical-user" } : null,
  technicalNoStore: { "cache-control": "private, no-store" },
  unauthorizedTechnicalResponse: () => Response.json({ message: "Acesso negado" }, { status: 403 })
}));
vi.mock("@/lib/melhor-envio-server", () => ({
  melhorEnvioEnvironment: () => {
    if (mocks.invalidEnvironment) throw new Error("configuration");
    return "sandbox";
  }, melhorEnvioOriginMissingFields: () => [],
  panelMelhorEnvioProvider: () => ({ healthCheck: mocks.health }),
  panelMelhorEnvioTokenKeyring: () => mocks.keyring
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
    mocks.invalidEnvironment = false;
    mocks.keyring = { activeKey, previousKeys: [] };
    mocks.readCredential.mockResolvedValue({ data: { status: "connected", access_token_ciphertext: "private-ciphertext" }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.health.mockResolvedValue({ state: "online" });
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

  it("ambiente inválido retorna 503 sem ler ou recriptografar outro ambiente", async () => {
    mocks.invalidEnvironment = true;
    const response = await GET(new NextRequest("https://panel.example.com/api/integrations/melhor-envio/status"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.readCredential).not.toHaveBeenCalled();
    expect(mocks.health).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("OAuth online não substitui o erro de autenticação da loja", async () => {
    const response = await GET(new NextRequest("https://panel.example.com/api/integrations/melhor-envio/status"));
    const body: unknown = await response.json();
    expect(body).toMatchObject({ connected: true, health: "online", storeShipping: {
      state: "offline", detail: expect.stringContaining("Não foi possível decifrar os tokens") as unknown
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

  it("mostra o motivo da falha OAuth do painel em vez de mascará-la como não configurado", async () => {
    mocks.health.mockResolvedValue({ state: "not_configured", failure: { reason: "token_key_unavailable" } });
    const body = await (await GET(new NextRequest("https://panel.example.com/api/integrations/melhor-envio/status"))).json() as Record<string, unknown>;
    expect(body).toMatchObject({ health: "not_configured", lastError: "token_key_unavailable",
      lastErrorDetail: expect.stringContaining("chave que não está configurada") as unknown });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ error_summary: "token_key_unavailable",
      metadata_sanitized: expect.objectContaining({ reason: "token_key_unavailable" }) as unknown }), { onConflict: "provider" });
  });

  it("chave anterior só é removível quando o registro está na chave ativa e a loja confirma a mesma chave", async () => {
    const activeKeyId = await melhorEnvioTokenKeyId(activeKey);
    const row = { status: "connected",
      access_token_ciphertext: await encryptMelhorEnvioToken("private-access", previousKey),
      refresh_token_ciphertext: await encryptMelhorEnvioToken("private-refresh", previousKey, "refresh_token") };
    mocks.keyring = { activeKey, previousKeys: [previousKey] };
    mocks.readCredential.mockResolvedValue({ data: row, error: null });
    mocks.readStoreHealth.mockResolvedValue({ data: { state: "online", checked_at: new Date().toISOString(),
      metadata_sanitized: { tokenKeyId: activeKeyId, environment: "sandbox" } }, error: null });
    const pending = await (await GET(new NextRequest("https://panel.example.com/api/integrations/melhor-envio/status"))).json() as Record<string, unknown>;
    expect(pending.keyRotation).toMatchObject({ activeKeyId, previousKeyCount: 1, accessToken: "previous", readable: true,
      reencryptionPending: true, sameActiveKey: true, previousKeysRemovable: false });
    expect(JSON.stringify(pending)).not.toMatch(/private-access|private-refresh|v2\.[0-9a-f]{12}\./u);

    mocks.readCredential.mockResolvedValue({ data: { status: "connected",
      access_token_ciphertext: await encryptMelhorEnvioToken("private-access", activeKey),
      refresh_token_ciphertext: await encryptMelhorEnvioToken("private-refresh", activeKey, "refresh_token") }, error: null });
    const migrated = await (await GET(new NextRequest("https://panel.example.com/api/integrations/melhor-envio/status"))).json() as Record<string, unknown>;
    expect(migrated.keyRotation).toMatchObject({ accessToken: "active", refreshToken: "active", previousKeysRemovable: true });

    mocks.readStoreHealth.mockResolvedValue({ data: { state: "online", metadata_sanitized: { tokenKeyId: "000000000000" } }, error: null });
    const divergent = await (await GET(new NextRequest("https://panel.example.com/api/integrations/melhor-envio/status"))).json() as Record<string, unknown>;
    expect(divergent.keyRotation).toMatchObject({ sameActiveKey: false, storeActiveKeyId: "000000000000", previousKeysRemovable: false });
  });

  it.each([
    ["diagnóstico antigo", "sandbox", new Date(Date.now() - 10 * 60_000).toISOString(), "online"],
    ["outro ambiente", "production", new Date().toISOString(), "online"],
    ["sem data", "sandbox", null, "online"],
    ["data inválida", "sandbox", "invalid", "online"],
    ["OAuth indisponível", "sandbox", new Date().toISOString(), "offline"]
  ])("não recomenda remover chaves anteriores: %s", async (_label, environment, checkedAt, health) => {
    const activeKeyId = await melhorEnvioTokenKeyId(activeKey);
    mocks.readCredential.mockResolvedValue({ data: { status: "connected",
      access_token_ciphertext: await encryptMelhorEnvioToken("private-access", activeKey),
      refresh_token_ciphertext: await encryptMelhorEnvioToken("private-refresh", activeKey, "refresh_token") }, error: null });
    mocks.health.mockResolvedValue({ state: health });
    mocks.readStoreHealth.mockResolvedValue({ data: { state: "online", checked_at: checkedAt,
      metadata_sanitized: { tokenKeyId: activeKeyId, environment } }, error: null });
    const body = await (await GET(new NextRequest("https://panel.example.com/api/integrations/melhor-envio/status"))).json() as Record<string, unknown>;
    expect(body.keyRotation).toMatchObject({ previousKeysRemovable: false });
  });
});
