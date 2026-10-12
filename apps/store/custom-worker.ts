// The OpenNext worker is generated during build and reused for HTTP traffic.
// @ts-expect-error generated build artifact
import handler from "./.open-next/worker.js";
// @ts-expect-error generated build artifact
import { runWithCloudflareRequestContext } from "./.open-next/cloudflare/init.js";
import { runExpirationHousekeeping } from "./src/lib/housekeeping";
import { runMelhorEnvioShippingJobs } from "./src/lib/melhor-envio-jobs";
import { runBlingJobs } from "./src/lib/bling-jobs";
import { runTransactionalEmailJobs } from "./src/lib/transactional-email-jobs";
import { logServerEvent } from "@curtiz/security";
import { optimizeStorefrontImageRequest, type StorefrontImageEnvironment } from "./src/lib/storefront-image-worker";

type WorkerEnvironment = Parameters<typeof runExpirationHousekeeping>[0] &
  Parameters<typeof runMelhorEnvioShippingJobs>[0] & Parameters<typeof runBlingJobs>[0] &
  Parameters<typeof runTransactionalEmailJobs>[0] & StorefrontImageEnvironment;
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };
const openNextHandler = handler as {
  fetch(request: Request, environment: WorkerEnvironment, context: WorkerContext): Response | Promise<Response>;
};
const runWithWorkerContext = runWithCloudflareRequestContext as (
  request: Request, environment: WorkerEnvironment, context: WorkerContext, task: () => Promise<void>
) => Promise<void>;
// Capture Workerd's transport before HTTP requests let Next patch global fetch.
// Cron tasks have no Next render/request storage and must use native I/O.
const scheduledFetch = globalThis.fetch.bind(globalThis);

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
    // Populate runtime bindings without depending on Next's HTTP request storage.
    const request = new Request(environment.NEXT_PUBLIC_STORE_URL ?? "https://curtiz.com.br");
    context.waitUntil(runWithWorkerContext(request, environment, context, async () => {
      const runQueue = async (queue: string, task: () => Promise<unknown>) => {
        try { await task(); }
        catch { logServerEvent("error", "scheduled_queue_failed", { executionId, queue }); }
      };
      await runQueue("expiration", () => runExpirationHousekeeping(environment, executionId, scheduledFetch));
      await runQueue("bling", () => runBlingJobs(environment, executionId, undefined, scheduledFetch));
      await runQueue("shipping", () => runMelhorEnvioShippingJobs(environment, executionId, undefined, scheduledFetch));
      await runQueue("transactional_email", () => runTransactionalEmailJobs(environment, executionId, undefined, scheduledFetch));
    }));
  }
};
