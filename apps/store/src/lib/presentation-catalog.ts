import { parseEnvironmentBoolean, type IntegrationEnvironment } from "@curtiz/config";

/**
 * Allows the local presentation catalog only when the environment explicitly
 * declares itself as demo or when checkout is explicitly disabled.
 */
export const isPresentationCatalogEnabled = (
  environment: IntegrationEnvironment = process.env
) =>
  parseEnvironmentBoolean(environment.DEMO_MODE) ||
  (environment.CHECKOUT_ENABLED !== undefined &&
    !parseEnvironmentBoolean(environment.CHECKOUT_ENABLED, true));
