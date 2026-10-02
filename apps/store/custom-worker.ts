// The OpenNext worker is generated during build and reused for HTTP traffic.
// @ts-expect-error generated build artifact
import handler from "./.open-next/worker.js";
import { runExpirationHousekeeping } from "./src/lib/housekeeping";
import { runMelhorEnvioShippingJobs } from "./src/lib/melhor-envio-jobs";
import { runBlingJobs } from "./src/lib/bling-jobs";
import { logServerEvent } from "@curtiz/security";
import { optimizeStorefrontImageRequest, type StorefrontImageEnvironment } from "./src/lib/storefront-image-worker";

type WorkerEnvironment = Parameters<typeof runExpirationHousekeeping>[0] &
  Parameters<typeof runMelhorEnvioShippingJobs>[0] & Parameters<typeof runBlingJobs>[0] & StorefrontImageEnvironment;
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };
const openNextHandler = handler as {
  fetch(request: Request, environment: WorkerEnvironment, context: WorkerContext): Response | Promise<Response>;
};

export default {
  async fetch(request: Request, environment: WorkerEnvironment, context: WorkerContext) {
    const optimizedImage = await optimizeStorefrontImageRequest(
      request,
      environment,
      (globalThis.caches as CacheStorage & { default: Cache }).default,
      context
    );
    return optimizedImage ?? openNextHandler.fetch(request, environment, context);
  },
  scheduled(_controller: unknown, environment: WorkerEnvironment, context: WorkerContext) {
    const executionId = crypto.randomUUID();
    context.waitUntil((async () => {
      const runQueue = async (queue: string, task: () => Promise<unknown>) => {
        try { await task(); }
        catch { logServerEvent("error", "scheduled_queue_failed", { executionId, queue }); }
      };
      await runQueue("expiration", () => runExpirationHousekeeping(environment, executionId));
      await runQueue("bling", () => runBlingJobs(environment, executionId));
      await runQueue("shipping", () => runMelhorEnvioShippingJobs(environment, executionId));
    })());
  }
};
