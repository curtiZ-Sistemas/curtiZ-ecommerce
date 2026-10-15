import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = {
  fetch: vi.fn(),
  nativeFetch: vi.fn<typeof fetch>(),
  optimize: vi.fn(),
  housekeeping: vi.fn(),
  shipping: vi.fn(),
  bling: vi.fn(),
  email: vi.fn(),
  context: vi.fn<(request: Request, environment: Environment, context: Context, task: () => Promise<void>) => Promise<void>>(),
  log: vi.fn()
};

type Environment = Record<string, string | undefined>;
type Context = { waitUntil(promise: Promise<unknown>): void };
type Worker = {
  fetch(request: Request, environment: Environment, context: Context): Promise<Response>;
  scheduled(controller: unknown, environment: Environment, context: Context): void;
};

// Exercise the real wrapper without requiring a generated OpenNext artifact or external services.
const source = readFileSync(resolve(process.cwd(), "apps/store/custom-worker.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} as { default: Worker } };
const workerGlobal = {
  module,
  exports: module.exports,
  crypto: { randomUUID: () => "scheduled-execution-id" },
  caches: { default: {} },
  Request,
  fetch: dependencies.nativeFetch,
  require: (specifier: string) => {
    if (specifier === "./worker-native-fetch") {
      const nativeModule = { exports: {} };
      const nativeSource = readFileSync(resolve(process.cwd(), "apps/store/worker-native-fetch.ts"), "utf8");
      const nativeCompiled = ts.transpileModule(nativeSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText;
      runInNewContext(nativeCompiled, { module: nativeModule, exports: nativeModule.exports, fetch: dependencies.nativeFetch });
      return nativeModule.exports;
    }
    if (specifier === "./.open-next/worker.js") return { default: { fetch: dependencies.fetch } };
    if (specifier === "./.open-next/cloudflare/init.js") return { runWithCloudflareRequestContext: dependencies.context };
    if (specifier === "./src/lib/housekeeping") return { runExpirationHousekeeping: dependencies.housekeeping };
    if (specifier === "./src/lib/melhor-envio-jobs") return { runMelhorEnvioShippingJobs: dependencies.shipping };
    if (specifier === "./src/lib/storefront-image-worker") return { optimizeStorefrontImageRequest: dependencies.optimize };
    if (specifier === "./src/lib/bling-jobs") return { runBlingJobs: dependencies.bling };
    if (specifier === "./src/lib/transactional-email-jobs") return { runTransactionalEmailJobs: dependencies.email };
    if (specifier === "@curtiz/security") return { logServerEvent: dependencies.log };
    throw new Error(`Unexpected Worker dependency: ${specifier}`);
  }
};
runInNewContext(compiled, workerGlobal);
const worker = module.exports.default;

describe("custom Worker handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    dependencies.context.mockImplementation((_request, _environment, _context, task) => task());
  });

  it("delegates HTTP requests and runtime bindings to OpenNext", async () => {
    const request = new Request("https://store.example.invalid/api/version");
    const environment = {};
    const context = { waitUntil: vi.fn() };
    const response = new Response("version");
    dependencies.optimize.mockResolvedValue(null);
    dependencies.fetch.mockResolvedValue(response);
    await expect(worker.fetch(request, environment, context)).resolves.toBe(response);
    expect(dependencies.fetch).toHaveBeenCalledWith(request, environment, context);
  });

  it("returns optimized images without invoking the page handler", async () => {
    const response = new Response("optimized image");
    dependencies.optimize.mockResolvedValue(response);
    await expect(worker.fetch(new Request("https://store.example.invalid/image"), {}, { waitUntil: vi.fn() }))
      .resolves.toBe(response);
    expect(dependencies.fetch).not.toHaveBeenCalled();
  });

  it("keeps all scheduled queues alive through waitUntil with runtime bindings", async () => {
    const environment = {};
    const context = { waitUntil: vi.fn() };
    dependencies.housekeeping.mockResolvedValue({ ok: true });
    dependencies.shipping.mockResolvedValue({ ok: true });
    dependencies.bling.mockResolvedValue({ ok: true });
    dependencies.email.mockResolvedValue({ ok: true });
    worker.scheduled({}, environment, context);
    expect(context.waitUntil).toHaveBeenCalledTimes(1);
    expect(dependencies.context).toHaveBeenCalledWith(expect.any(Request), environment, context, expect.any(Function));
    await expect(context.waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
    expect(dependencies.housekeeping).toHaveBeenCalledWith(environment, "scheduled-execution-id", expect.any(Function));
    for (const job of [dependencies.bling, dependencies.shipping, dependencies.email]) {
      expect(job).toHaveBeenCalledWith(environment, "scheduled-execution-id", undefined, expect.any(Function));
    }
  });

  it("retains native I/O after HTTP handling replaces global fetch", async () => {
    const patchedFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("No Next request storage"));
    workerGlobal.fetch = patchedFetch;
    const response = new Response("native transport");
    dependencies.nativeFetch.mockResolvedValue(response);
    const context = { waitUntil: vi.fn() };
    worker.scheduled({}, {}, context);
    await context.waitUntil.mock.calls[0]?.[0];
    const transport = dependencies.housekeeping.mock.calls[0]?.[2] as typeof fetch;
    await expect(transport("https://example.invalid/rpc")).resolves.toBe(response);
    for (const job of [dependencies.bling, dependencies.shipping, dependencies.email])
      expect(job.mock.calls[0]?.[3]).toBe(transport);
    expect(patchedFetch).not.toHaveBeenCalled();
    workerGlobal.fetch = dependencies.nativeFetch;
  });

  it("captures native I/O before importing OpenNext can replace global fetch", async () => {
    const response = new Response("native transport before imports");
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const patchedFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("No Next request storage"));
    const freshModule = { exports: {} as { default: Worker } };
    const globals = { ...workerGlobal, module: freshModule, exports: freshModule.exports, fetch: nativeFetch };
    globals.require = (specifier: string) => {
      if (specifier === "./worker-native-fetch") {
        const nativeModule = { exports: {} };
        const nativeSource = readFileSync(resolve(process.cwd(), "apps/store/worker-native-fetch.ts"), "utf8");
        const nativeCompiled = ts.transpileModule(nativeSource, {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
        }).outputText;
        runInNewContext(nativeCompiled, { ...globals, module: nativeModule, exports: nativeModule.exports });
        return nativeModule.exports;
      }
      if (specifier === "./.open-next/worker.js") globals.fetch = patchedFetch;
      return workerGlobal.require(specifier);
    };
    runInNewContext(compiled, globals);
    const context = { waitUntil: vi.fn() };
    freshModule.exports.default.scheduled({}, {}, context);
    await context.waitUntil.mock.calls[0]?.[0];
    const transport = dependencies.housekeeping.mock.calls[0]?.[2] as typeof fetch;
    await expect(transport("https://example.invalid/rpc")).resolves.toBe(response);
    expect(patchedFetch).not.toHaveBeenCalled();
    expect(nativeFetch).toHaveBeenCalledOnce();
    expect(dependencies.log).toHaveBeenCalledWith("info", "scheduled_transport_selected", expect.objectContaining({
      nextFetchPatchedAtCapture: false
    }));
  });

  it("runs queues only inside the OpenNext request context", async () => {
    let task: (() => Promise<void>) | undefined;
    dependencies.context.mockImplementation((_request, _environment, _context, callback) => {
      task = callback;
      return Promise.resolve();
    });
    worker.scheduled({}, {}, { waitUntil: vi.fn() });
    for (const job of [dependencies.housekeeping, dependencies.bling, dependencies.shipping, dependencies.email])
      expect(job).not.toHaveBeenCalled();
    expect(task).toBeTypeOf("function");
    await task?.();
    for (const job of [dependencies.housekeeping, dependencies.bling, dependencies.shipping, dependencies.email])
      expect(job).toHaveBeenCalledOnce();
  });

  it.each([
    ["expiration", "housekeeping"], ["bling", "bling"], ["shipping", "shipping"], ["transactional_email", "email"]
  ] as const)("isolates a failure in %s while running the remaining queues", async (queue, dependency) => {
    for (const job of [dependencies.housekeeping, dependencies.bling, dependencies.shipping, dependencies.email])
      job.mockResolvedValue({ ok: true });
    dependencies[dependency].mockRejectedValue(new Error("test-only provider failure"));
    const context = { waitUntil: vi.fn() };
    worker.scheduled({}, {}, context);
    await expect(context.waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
    for (const job of [dependencies.housekeeping, dependencies.bling, dependencies.shipping, dependencies.email])
      expect(job).toHaveBeenCalledOnce();
    expect(dependencies.log).toHaveBeenCalledWith("error", "scheduled_queue_failed", {
      executionId: "scheduled-execution-id", queue, errorType: "other"
    });
  });
});
