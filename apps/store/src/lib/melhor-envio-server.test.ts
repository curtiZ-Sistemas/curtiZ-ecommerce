import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptMelhorEnvioToken } from "@curtiz/integrations";
import { createMelhorEnvioProvider, resolveShippingProducts } from "./melhor-envio-server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/unknown-data", () => vi.importActual("./unknown-data"));

const key = Buffer.alloc(32, 7).toString("base64");
const environment = {
  MELHOR_ENVIO_ENVIRONMENT: "sandbox", MELHOR_ENVIO_CLIENT_ID: "test-client",
  MELHOR_ENVIO_CLIENT_SECRET: "test-secret", MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: key,
  MELHOR_ENVIO_APP_NAME: "curti Z", MELHOR_ENVIO_TECHNICAL_CONTACT: "tech@example.com",
  MELHOR_ENVIO_REDIRECT_URI: "https://panel.example.com/api/integrations/melhor-envio/callback"
};
const line = { productId: "product-id", variantId: "variant-id", quantity: 2 };
const product = { id: "product-id", status: "active", base_price: 59.9, weight_grams: 350, width_cm: 12, height_cm: 8, length_cm: 25 };
const variant = { id: "variant-id", product_id: "product-id", active: true, price_override: 69.9, products: product };
const quoteInput = { originPostalCode: "01001-000", destinationPostalCode: "20040002",
  products: [{ id: "variant-id", quantity: 2, weightKg: 0.35, widthCm: 12, heightCm: 8, lengthCm: 25, insuranceValue: 69.9 }] };
type Database = Parameters<typeof createMelhorEnvioProvider>[1];

afterEach(() => vi.unstubAllGlobals());

describe("catálogo → OAuth cifrado → cotação Melhor Envio", () => {
  const catalogDatabase = (rows: unknown): Database => ({ from: () => ({
    select: () => ({ in: async () => ({ data: rows, error: null }) })
  }) }) as never;

  it("usa preços, peso em kg e dimensões do banco e invalida a assinatura se a quantidade mudar", async () => {
    const db = catalogDatabase([variant]);
    const resolved = await resolveShippingProducts([line], db);
    expect(resolved.products).toEqual(quoteInput.products);
    expect((await resolveShippingProducts([{ ...line, quantity: 1 }], db)).fingerprint).not.toBe(resolved.fingerprint);
  });

  it.each([0, null, -1])("recusa peso inválido sem fabricar dimensões (%s)", async (weight) => {
    const db = catalogDatabase([{ ...variant, products: { ...product, weight_grams: weight } }]);
    await expect(resolveShippingProducts([line], db)).rejects.toMatchObject({ code: "validation", httpStatus: 409 });
  });

  it("não mascara RPC de credenciais indisponível como OAuth desconectado", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST202" } }) } as never;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createMelhorEnvioProvider(environment, db).quote(quoteInput)).rejects.toMatchObject({
      code: "provider_unavailable", diagnostic: { reason: "credentials_read_failed", databaseCode: "PGRST202" }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("identifica chave diferente entre os Workers sem chamar a API", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: { status: "connected",
      access_token_ciphertext: await encryptMelhorEnvioToken("private-access", Buffer.alloc(32, 8).toString("base64")),
      refresh_token_ciphertext: "unused", access_token_expires_at: "2099-01-01T00:00:00Z"
    }, error: null }) } as never;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createMelhorEnvioProvider(environment, db).quote(quoteInput)).rejects.toMatchObject({
      code: "authentication", diagnostic: { reason: "token_key_unavailable" }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renova e persiste tokens cifrados antes de cotar, com o mesmo ambiente normalizado", async () => {
    const tokenRow = { status: "connected", access_token_ciphertext: await encryptMelhorEnvioToken("old-access", key),
      refresh_token_ciphertext: await encryptMelhorEnvioToken("old-refresh", key, "refresh_token"), access_token_expires_at: "2000-01-01T00:00:00Z" };
    const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>()
      .mockImplementation(async (name) => ({ data: name === "read_integration_credential" ? tokenRow : true, error: null }));
    const db = { rpc } as never;
    const fetchMock = vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 2592000 })))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, name: "PAC", price: "18.50", custom_price: "20.25",
        delivery_time: 5, company: { name: "Correios" }, packages: [{ weight: "0.7" }] }])));
    vi.stubGlobal("fetch", fetchMock);
    const resolved = await resolveShippingProducts([line], catalogDatabase([variant]));
    const quotes = await createMelhorEnvioProvider({ ...environment, MELHOR_ENVIO_ENVIRONMENT: " PRODUCTION " }, db)
      .quote({ ...quoteInput, products: resolved.products });
    expect(quotes[0]).toMatchObject({ amountInCents: 2025, costInCents: 1850 });
    expect(rpc).toHaveBeenCalledWith("read_integration_credential", { p_provider: "melhorenvio", p_environment: "production" });
    const saved = rpc.mock.calls.find(([name]) => name === "save_integration_credential");
    expect(saved?.[1]).toMatchObject({ p_environment: "production", p_access_token_ciphertext: expect.stringMatching(/^v2\.[0-9a-f]{12}\./u) as unknown });
    expect(JSON.stringify(saved)).not.toMatch(/new-access|new-refresh/u);
    expect(fetchMock.mock.calls[0]?.[0].origin).toBe("https://melhorenvio.com.br");
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer new-access");
    const requestBody: unknown = typeof init.body === "string" ? JSON.parse(init.body) : null;
    expect(requestBody).toMatchObject({ from: { postal_code: "01001000" }, products: quoteInput.products.map(p => ({
      id: p.id, quantity: p.quantity, weight: p.weightKg, width: p.widthCm, height: p.heightCm, length: p.lengthCm, insurance_value: p.insuranceValue
    })) });
  });

  it("lê tokens v1 com a chave anterior e recifra os dois via RPC compare-and-swap", async () => {
    const previous = Buffer.alloc(32, 8).toString("base64");
    const legacy = async (value: string) => {
      const imported = await crypto.subtle.importKey("raw", Buffer.from(previous, "base64"), "AES-GCM", false, ["encrypt"]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, imported, new TextEncoder().encode(value));
      return `v1.${Buffer.from(iv).toString("base64")}.${Buffer.from(encrypted).toString("base64")}`;
    };
    const tokenRow = { status: "connected", access_token_ciphertext: await legacy("old-access"),
      refresh_token_ciphertext: await legacy("old-refresh"), access_token_expires_at: "2099-01-01T00:00:00Z" };
    const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>()
      .mockImplementation(async (name) => ({ data: name === "read_integration_credential" ? tokenRow : true, error: null }));
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createMelhorEnvioProvider({ ...environment, MELHOR_ENVIO_TOKEN_ENCRYPTION_PREVIOUS_KEYS: previous }, { rpc } as never)
      .health()).resolves.toBe("online");
    const replaced = rpc.mock.calls.find(([name]) => name === "replace_integration_credential_ciphertext");
    expect(replaced?.[1]).toMatchObject({ p_provider: "melhorenvio", p_environment: "sandbox",
      p_expected_access_token_ciphertext: tokenRow.access_token_ciphertext,
      p_expected_refresh_token_ciphertext: tokenRow.refresh_token_ciphertext,
      p_access_token_ciphertext: expect.stringMatching(/^v2\.[0-9a-f]{12}\./u) as unknown,
      p_refresh_token_ciphertext: expect.stringMatching(/^v2\.[0-9a-f]{12}\./u) as unknown });
    expect(JSON.stringify(replaced)).not.toMatch(/old-access|old-refresh/u);
    expect(rpc.mock.calls.some(([name]) => name === "save_integration_credential")).toBe(false);
    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get("authorization")).toBe("Bearer old-access");
  });

  it.each(["claim_integration_refresh", "save_integration_credential"])("falha fechada se %s falhar", async (failedRpc) => {
    const tokenRow = { status: "connected", access_token_ciphertext: await encryptMelhorEnvioToken("old-access", key),
      refresh_token_ciphertext: await encryptMelhorEnvioToken("old-refresh", key, "refresh_token"), access_token_expires_at: "2000-01-01T00:00:00Z" };
    const rpc = vi.fn(async (name: string) => ({ data: name === "read_integration_credential" ? tokenRow : true,
      error: name === failedRpc ? { code: "42501" } : null }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 2592000 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createMelhorEnvioProvider(environment, { rpc } as never).quote(quoteInput)).rejects.toMatchObject({
      diagnostic: { reason: failedRpc === "claim_integration_refresh" ? "refresh_lock_failed" : "credentials_write_failed" }
    });
    expect(fetchMock).toHaveBeenCalledTimes(failedRpc === "claim_integration_refresh" ? 0 : 1);
  });
});
