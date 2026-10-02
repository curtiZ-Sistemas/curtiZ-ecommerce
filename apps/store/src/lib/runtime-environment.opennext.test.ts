import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getStoreRuntimeEnvironment } from "./runtime-environment";

vi.mock("server-only", () => ({}));

// Sem mock de @opennextjs/cloudflare: usa o getCloudflareContext real da versão instalada.
const packageRoot = resolve(dirname(createRequire(import.meta.url).resolve("@opennextjs/cloudflare")), "../..");
const template = (name: string) => readFileSync(resolve(packageRoot, "dist/cli/templates", name), "utf8");

// Reproduz exatamente o que templates/init.js faz em runWithCloudflareRequestContext.
const contextStorage = new AsyncLocalStorage<{ env: Record<string, unknown>; ctx: unknown; cf: unknown }>();
Object.defineProperty(globalThis, Symbol.for("__cloudflare-context__"), {
  configurable: true,
  get: () => contextStorage.getStore()
});

describe("contexto do OpenNext no Worker da loja", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("o template instalado envolve toda requisição no contexto com os bindings do Worker", () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as { version: string };
    expect(packageJson.version).toBe("1.20.2");
    expect(template("worker.js")).toMatch(/async fetch\(request, env, ctx\) \{\s*return runWithCloudflareRequestContext\(request, env, ctx,/u);
    const init = template("init.js");
    expect(init).toContain('Object.defineProperty(globalThis, Symbol.for("__cloudflare-context__")');
    expect(init).toContain("return cloudflareContextALS.run({ env, ctx, cf: request.cf }, handler);");
  });

  it("mantém os bindings isolados entre requisições concorrentes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const environments = [{ SHIPPING_PROVIDER: "disabled" }, { SHIPPING_PROVIDER: "melhorenvio" }];
    const results = await Promise.all(environments.map((env) =>
      contextStorage.run({ env, ctx: {}, cf: undefined }, async () => {
        await Promise.resolve();
        return getStoreRuntimeEnvironment().SHIPPING_PROVIDER;
      })
    ));
    expect(results).toEqual(environments.map((env) => env.SHIPPING_PROVIDER));
  });

  it("lê bindings de runtime dentro da requisição mesmo com process.env desativado pelo build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SHIPPING_PROVIDER", "disabled");
    vi.stubEnv("MELHOR_ENVIO_ENABLED", "false");
    const env = { SHIPPING_PROVIDER: "melhorenvio", MELHOR_ENVIO_ENABLED: "true", MELHOR_ENVIO_CLIENT_SECRET: "runtime-secret" };

    const environment = await contextStorage.run({ env, ctx: {}, cf: undefined }, () => Promise.resolve(getStoreRuntimeEnvironment()));

    expect(environment).toMatchObject(env);
  });

  it("falha explicitamente fora do contexto em produção, sem cair nas flags do build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SHIPPING_PROVIDER", "disabled");
    expect(() => getStoreRuntimeEnvironment()).toThrow();
  });
});
