import { getIntegrationConfig, getMelhorEnvioReadiness } from "@curtiz/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getStoreRuntimeEnvironment, mergeCloudflareRuntimeBindings } from "./runtime-environment";

const cloudflare = vi.hoisted((): { env: Record<string, unknown> } => ({ env: {} }));

vi.mock("server-only", () => ({}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: cloudflare.env }) }));

// Mesmos valores usados pelo job de build do CI: integrações desativadas e sem secrets.
const buildEnvironment = {
  CHECKOUT_ENABLED: "false",
  PAYMENT_PROVIDER: "disabled",
  MERCADO_PAGO_ENABLED: "false",
  SHIPPING_PROVIDER: "disabled",
  MELHOR_ENVIO_ENABLED: "false",
  MELHOR_ENVIO_CLIENT_SECRET: undefined,
  MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: undefined
};

// Configuração mantida somente no Runtime do Worker (variables + secrets).
const runtimeBindings = {
  CHECKOUT_ENABLED: "true",
  SHIPPING_PROVIDER: "melhorenvio",
  MELHOR_ENVIO_ENABLED: "true",
  MELHOR_ENVIO_ENVIRONMENT: "sandbox",
  MELHOR_ENVIO_BASE_URL: "https://sandbox.melhorenvio.com.br",
  MELHOR_ENVIO_REDIRECT_URI: "https://store.example.com/api/shipping/melhor-envio/callback",
  MELHOR_ENVIO_CLIENT_ID: "client-id",
  MELHOR_ENVIO_CLIENT_SECRET: "runtime-client-secret",
  MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
  MELHOR_ENVIO_APP_NAME: "curti Z",
  MELHOR_ENVIO_TECHNICAL_CONTACT: "tech@example.com",
  MELHOR_ENVIO_ORIGIN_NAME: "Loja Teste",
  MELHOR_ENVIO_ORIGIN_EMAIL: "origem@example.com",
  MELHOR_ENVIO_ORIGIN_PHONE: "11999999999",
  MELHOR_ENVIO_ORIGIN_DOCUMENT: "12345678909",
  MELHOR_ENVIO_ORIGIN_ADDRESS: "Rua Teste",
  MELHOR_ENVIO_ORIGIN_NUMBER: "100",
  MELHOR_ENVIO_ORIGIN_DISTRICT: "Centro",
  MELHOR_ENVIO_ORIGIN_CITY: "São Paulo",
  MELHOR_ENVIO_ORIGIN_STATE: "SP",
  MELHOR_ENVIO_ORIGIN_POSTAL_CODE: "01001000"
};

describe("bindings de runtime do Worker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    cloudflare.env = {};
  });

  it("prioriza bindings de runtime sobre valores desativados usados no build", () => {
    expect(mergeCloudflareRuntimeBindings({
      SHIPPING_PROVIDER: "disabled",
      MELHOR_ENVIO_ENABLED: "false",
      MELHOR_ENVIO_CLIENT_SECRET: undefined
    }, {
      SHIPPING_PROVIDER: "melhorenvio",
      MELHOR_ENVIO_ENABLED: "true",
      MELHOR_ENVIO_CLIENT_SECRET: "runtime-secret",
      ASSETS: { fetch: () => undefined },
      IGNORED_BOOLEAN_BINDING: true
    })).toEqual({
      SHIPPING_PROVIDER: "melhorenvio",
      MELHOR_ENVIO_ENABLED: "true",
      MELHOR_ENVIO_CLIENT_SECRET: "runtime-secret"
    });
  });

  it("não deixa o build desativado desligar o frete habilitado no runtime", () => {
    const environment = mergeCloudflareRuntimeBindings(buildEnvironment, runtimeBindings);

    expect(environment.SHIPPING_PROVIDER).toBe("melhorenvio");
    expect(environment.MELHOR_ENVIO_ENABLED).toBe("true");
    expect(getMelhorEnvioReadiness(environment)).toEqual({ configured: true, missing: [], invalid: [] });
    expect(getIntegrationConfig(environment).shipping).toEqual({
      provider: "melhorenvio",
      enabled: true,
      melhorEnvioEnabled: true
    });
  });

  it("mantém os secrets de runtime disponíveis após a mescla", () => {
    const environment = mergeCloudflareRuntimeBindings(buildEnvironment, runtimeBindings);

    expect(environment.MELHOR_ENVIO_CLIENT_SECRET).toBe("runtime-client-secret");
    expect(environment.MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY).toBe(runtimeBindings.MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY);
    expect(environment.MELHOR_ENVIO_ORIGIN_DOCUMENT).toBe("12345678909");
  });

  it("preserva valores do build apenas quando o runtime não os define", () => {
    const environment = mergeCloudflareRuntimeBindings(
      { ...buildEnvironment, PAYMENT_PROVIDER: "disabled" },
      { SHIPPING_PROVIDER: "melhorenvio" }
    );

    expect(environment.PAYMENT_PROVIDER).toBe("disabled");
    expect(environment.SHIPPING_PROVIDER).toBe("melhorenvio");
  });

  it("lê o contexto do Cloudflare por requisição em getStoreRuntimeEnvironment", () => {
    for (const [name, value] of Object.entries(buildEnvironment)) vi.stubEnv(name, value ?? "");
    cloudflare.env = { ...runtimeBindings, ASSETS: { fetch: () => undefined } };

    const environment = getStoreRuntimeEnvironment();

    expect(environment.SHIPPING_PROVIDER).toBe("melhorenvio");
    expect(environment.MELHOR_ENVIO_ENABLED).toBe("true");
    expect(environment.CHECKOUT_ENABLED).toBe("true");
    expect(environment.MELHOR_ENVIO_CLIENT_SECRET).toBe("runtime-client-secret");
    expect(getIntegrationConfig(environment).shipping.enabled).toBe(true);
  });
});
