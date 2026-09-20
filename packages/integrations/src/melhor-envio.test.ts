import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptMelhorEnvioToken,
  encryptMelhorEnvioToken,
  MelhorEnvioError,
  MelhorEnvioProvider,
  type MelhorEnvioConfig,
  type MelhorEnvioTokenStore,
  type MelhorEnvioTokens
} from "./melhor-envio";

const config: MelhorEnvioConfig = {
  environment: "sandbox", clientId: "123", clientSecret: "secret",
  redirectUri: "https://panel.example.com/api/integrations/melhor-envio/callback",
  applicationName: "curti Z", technicalContact: "tech@example.com"
};

const initialTokens = (): MelhorEnvioTokens => ({ accessToken: "access", refreshToken: "refresh",
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z", refreshTokenExpiresAt: "2099-02-01T00:00:00.000Z" });

const store = (initial = initialTokens()) => {
  let tokens: MelhorEnvioTokens | null = initial;
  const value: MelhorEnvioTokenStore & { current: () => MelhorEnvioTokens | null } = {
    read: async () => tokens,
    write: async (next) => { tokens = next; },
    withRefreshLock: async (operation) => operation(),
    current: () => tokens
  };
  return value;
};

afterEach(() => vi.unstubAllGlobals());

describe("MelhorEnvioProvider", () => {
  it("deriva o host do ambiente e rejeita URL legada arbitrária", () => {
    expect(() => new MelhorEnvioProvider({ ...config, legacyBaseUrl: "https://attacker.example" }, store()))
      .toThrowError(MelhorEnvioError);
    expect(new MelhorEnvioProvider(config, store()).baseUrl).toBe("https://sandbox.melhorenvio.com.br");
  });

  it("usa preço/prazo customizados e ignora serviços inválidos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { id: 1, name: "PAC", price: "18.50", custom_price: "20.25", delivery_time: 5,
        custom_delivery_time: 7, company: { name: "Correios" }, packages: [{ weight: "1" }] },
      { id: 2, name: "Inválido", price: "10", delivery_time: 2, company: { name: "X" }, packages: [], error: "unavailable" }
    ]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const quotes = await new MelhorEnvioProvider(config, store()).quote({ originPostalCode: "01001000",
      destinationPostalCode: "20040002", products: [{ id: "variant-1", quantity: 2, weightKg: 0.35,
        widthCm: 12, heightCm: 8, lengthCm: 25, insuranceValue: 59.9 }] });
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ serviceId: "1", carrier: "Correios", amountInCents: 2025,
      costInCents: 1850, estimatedDays: 7 });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = typeof request.body === "string" ? JSON.parse(request.body) as unknown : null;
    expect(requestBody).toMatchObject({ products: [{ weight: 0.35, insurance_value: 59.9, quantity: 2 }] });
    expect(new Headers(request.headers).get("user-agent")).toBe("curti Z (tech@example.com)");
  });

  it("renova OAuth uma vez após 401 e persiste tokens rotativos", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Unauthenticated" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 2592000 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const tokenStore = store();
    await expect(new MelhorEnvioProvider(config, tokenStore).health()).resolves.toBe("online");
    expect(tokenStore.current()).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("evita refresh duplicado quando requisições concorrentes recebem 401", async () => {
    let tokens: MelhorEnvioTokens | null = initialTokens();
    let tail = Promise.resolve();
    const tokenStore: MelhorEnvioTokenStore = {
      read: async () => tokens,
      write: async (next) => { tokens = next; },
      async withRefreshLock(operation) {
        const previous = tail;
        let unlock: () => void = () => undefined;
        tail = new Promise<void>((resolve) => { unlock = resolve; });
        await previous;
        try { return await operation(); } finally { unlock(); }
      }
    };
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/oauth/token") {
        refreshes += 1;
        return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 2592000 }));
      }
      return new Headers(init?.headers).get("authorization") === "Bearer new-access"
        ? new Response(JSON.stringify([]))
        : new Response(JSON.stringify({ message: "Unauthenticated" }), { status: 401 });
    }));
    const provider = new MelhorEnvioProvider(config, tokenStore);
    await expect(Promise.all([provider.health(), provider.health()])).resolves.toEqual(["online", "online"]);
    expect(refreshes).toBe(1);
  });

  it("classifica escrita com falha de rede como resultado incerto", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network details must not escape")));
    await expect(new MelhorEnvioProvider(config, store()).purchase(["external-id"]))
      .rejects.toMatchObject({ code: "uncertain_write", retryable: false });
  });

  it.each([
    [422, "validation", false],
    [429, "rate_limited", true],
    [500, "provider_unavailable", true]
  ] as const)("sanitiza HTTP %s como %s", async (status, code, retryable) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "detalhe interno" }), { status })));
    await expect(new MelhorEnvioProvider(config, store()).quote({ originPostalCode: "01001000",
      destinationPostalCode: "20040002", products: [{ id: "variant-1", quantity: 1, weightKg: 0.35,
        widthCm: 12, heightCm: 8, lengthCm: 25, insuranceValue: 59.9 }] }))
      .rejects.toMatchObject({ code, retryable });
  });

  it("classifica timeout de leitura como recuperável sem expor a causa", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("internal", "TimeoutError")));
    await expect(new MelhorEnvioProvider(config, store()).track(["external-id"]))
      .rejects.toMatchObject({ code: "timeout", retryable: true });
  });

  it("rejeita URL de etiqueta fora do host allowlisted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: "https://sandbox.melhorenvio.com.br.attacker.example/label"
    }))));
    await expect(new MelhorEnvioProvider(config, store()).preview(["external-id"]))
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it("cifra tokens com AES-GCM e detecta chave incorreta", async () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const otherKey = Buffer.alloc(32, 8).toString("base64");
    const encrypted = await encryptMelhorEnvioToken("sensitive-token", key);
    expect(encrypted).not.toContain("sensitive-token");
    await expect(decryptMelhorEnvioToken(encrypted, key)).resolves.toBe("sensitive-token");
    await expect(decryptMelhorEnvioToken(encrypted, otherKey)).rejects.toMatchObject({ code: "authentication" });
  });
});
