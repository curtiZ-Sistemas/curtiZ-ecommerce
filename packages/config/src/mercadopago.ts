import type { IntegrationEnvironment } from "./integrations";

export type MercadoPagoEnvironment = "test" | "production";

// Changing keys alone must never activate real charges.
export function getMercadoPagoEnvironment(environment: IntegrationEnvironment = process.env): MercadoPagoEnvironment | null {
  const selected = environment.MERCADO_PAGO_ENVIRONMENT?.trim() || "test";
  if (selected === "test") return selected;
  return selected === "production" && environment.MERCADO_PAGO_PRODUCTION_READY === "true" ? selected : null;
}

export function getMercadoPagoCredentials(environment: IntegrationEnvironment = process.env) {
  const mode = getMercadoPagoEnvironment(environment);
  const accessToken = environment.MERCADO_PAGO_ACCESS_TOKEN?.trim() ?? "";
  const publicKey = environment.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim() ?? "";
  const prefix = mode === "production" ? "APP_USR-" : "TEST-";
  return mode && accessToken.startsWith(prefix) && publicKey.startsWith(prefix)
    ? { mode, accessToken, publicKey } : null;
}
