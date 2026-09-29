import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeCloudflareRuntimeBindings } from "./runtime-environment";

vi.mock("server-only", () => ({}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: {} }) }));

describe("bindings de runtime do Worker", () => {
  afterEach(() => vi.unstubAllEnvs());

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
});
