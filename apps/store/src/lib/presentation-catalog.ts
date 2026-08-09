import { parseEnvironmentBoolean, type IntegrationEnvironment } from "@curtiz/config";

/** Allows local presentation data only when demo mode is explicit. */
export const isPresentationCatalogEnabled = (
  environment: IntegrationEnvironment = process.env
) => parseEnvironmentBoolean(environment.DEMO_MODE);
