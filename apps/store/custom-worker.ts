// The OpenNext worker is generated during build and reused for HTTP traffic.
// @ts-expect-error generated build artifact
import handler from "./.open-next/worker.js";
import { runExpirationHousekeeping } from "./src/lib/housekeeping";
import { runMelhorEnvioShippingJobs } from "./src/lib/melhor-envio-jobs";

type WorkerEnvironment = Parameters<typeof runExpirationHousekeeping>[0] & Parameters<typeof runMelhorEnvioShippingJobs>[0];
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

export default {
  fetch: handler.fetch,
  scheduled(_controller: unknown, environment: WorkerEnvironment, context: WorkerContext) {
    const executionId = crypto.randomUUID();
    context.waitUntil(Promise.all([
      runExpirationHousekeeping(environment, executionId),
      runMelhorEnvioShippingJobs(environment, executionId)
    ]));
  }
};
