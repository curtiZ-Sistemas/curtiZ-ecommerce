// Capture the logging transport before importing the generated Next handler.
import { recordApplicationAccess, type AccessLogEnvironment } from "@curtiz/security/application-access-log";
// @ts-expect-error generated build artifact
import handler from "./.open-next/worker.js";

type WorkerContext = { waitUntil(promise: Promise<unknown>): void };
const openNextHandler = handler as {
  fetch(request: Request, environment: AccessLogEnvironment, context: WorkerContext): Response | Promise<Response>;
};

export default {
  ...openNextHandler,
  fetch(request: Request, environment: AccessLogEnvironment, context: WorkerContext) {
    context.waitUntil(recordApplicationAccess(request, environment, "panel"));
    return openNextHandler.fetch(request, environment, context);
  }
};
