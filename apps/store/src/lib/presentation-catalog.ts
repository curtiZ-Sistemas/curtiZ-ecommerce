import { parseEnvironmentBoolean, type IntegrationEnvironment } from "@curtiz/config";

/**
 * Allows the local presentation catalog only when the environment explicitly
 * declares itself as demo or while checkout is not active. Checkout defaults
 * to disabled in the shared environment contract, so an initial presentation
 * deploy remains useful even before the remote catalog is populated.
 */
export const isPresentationCatalogEnabled = (
  environment: IntegrationEnvironment = process.env
) =>
  parseEnvironmentBoolean(environment.DEMO_MODE) ||
  !parseEnvironmentBoolean(environment.CHECKOUT_ENABLED);
