// The OpenNext worker is generated during build and reused for HTTP traffic.
// @ts-expect-error generated build artifact
import handler from "./.open-next/worker.js";
import { runExpirationHousekeeping } from "./src/lib/housekeeping";
import { runMelhorEnvioShippingJobs } from "./src/lib/melhor-envio-jobs";
import { optimizeStorefrontImageRequest, type StorefrontImageEnvironment } from "./src/lib/storefront-image-worker";

type WorkerEnvironment = Parameters<typeof runExpirationHousekeeping>[0] &
  Parameters<typeof runMelhorEnvioShippingJobs>[0] & StorefrontImageEnvironment;
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

export default {
  async fetch(request: Request, environment: WorkerEnvironment, context: WorkerContext) {
    const optimizedImage = await optimizeStorefrontImageRequest(
      request,
      environment,
      (globalThis.caches as CacheStorage & { default: Cache }).default,
      context
    );
    return optimizedImage ?? handler.fetch(request, environment, context);
  },
  scheduled(_controller: unknown, environment: WorkerEnvironment, context: WorkerContext) {
    const executionId = crypto.randomUUID();
    context.waitUntil(Promise.all([
      runExpirationHousekeeping(environment, executionId),
      runMelhorEnvioShippingJobs(environment, executionId)
    ]));
  }
};
