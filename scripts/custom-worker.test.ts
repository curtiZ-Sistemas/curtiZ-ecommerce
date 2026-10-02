import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = {
  fetch: vi.fn(),
  optimize: vi.fn(),
  housekeeping: vi.fn(),
  shipping: vi.fn(),
  bling: vi.fn(),
  email: vi.fn(),
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
runInNewContext(compiled, {
  module,
  exports: module.exports,
  crypto: { randomUUID: () => "scheduled-execution-id" },
  caches: { default: {} },
  require: (specifier: string) => {
    if (specifier === "./.open-next/worker.js") return { default: { fetch: dependencies.fetch } };
    if (specifier === "./src/lib/housekeeping") return { runExpirationHousekeeping: dependencies.housekeeping };
    if (specifier === "./src/lib/melhor-envio-jobs") return { runMelhorEnvioShippingJobs: dependencies.shipping };
    if (specifier === "./src/lib/storefront-image-worker") return { optimizeStorefrontImageRequest: dependencies.optimize };
    if (specifier === "./src/lib/bling-jobs") return { runBlingJobs: dependencies.bling };
    if (specifier === "./src/lib/transactional-email-jobs") return { runTransactionalEmailJobs: dependencies.email };
    if (specifier === "@curtiz/security") return { logServerEvent: dependencies.log };
    throw new Error(`Unexpected Worker dependency: ${specifier}`);
  }
});
const worker = module.exports.default;

describe("custom Worker handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    await expect(context.waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
    for (const job of [dependencies.housekeeping, dependencies.bling, dependencies.shipping, dependencies.email]) {
      expect(job).toHaveBeenCalledWith(environment, "scheduled-execution-id");
    }
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
      executionId: "scheduled-execution-id", queue
    });
  });
});
