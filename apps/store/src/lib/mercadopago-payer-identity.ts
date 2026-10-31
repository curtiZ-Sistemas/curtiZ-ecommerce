import { isValidCpf } from "./personal-data";

export type MercadoPagoPaymentMode = "test" | "production";

export function readMercadoPagoPayerDocument(
  value: string,
  paymentMode: MercadoPagoPaymentMode,
  customerLastFour?: string
): string | null {
  const trimmed = value.trim();
  if (!/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/u.test(trimmed)) return null;
  const document = trimmed.replace(/\D/gu, "");
  if (/^(\d)\1{10}$/u.test(document)) return null;
  // Sandbox documents belong to the provider, not to the customer's saved identity.
  if (paymentMode === "test") return document;
  if (!isValidCpf(document)) return null;
  if (customerLastFour !== undefined &&
    (!/^\d{4}$/u.test(customerLastFour) || !document.endsWith(customerLastFour))) return null;
  return document;
}
