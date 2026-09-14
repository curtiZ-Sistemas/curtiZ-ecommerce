import { isUnknownRecord } from "./unknown-data";
import { isValidBrazilianPhone, isValidCpf, isValidCustomerEmail } from "./personal-data";

export type CheckoutRequiredField =
  | "name" | "email" | "phone" | "cpf"
  | "postalCode" | "street" | "number" | "district" | "city" | "state" | "items";

type CheckoutReadinessInput = {
  customer: { name: string; email: string; phone: string; cpf: string };
  address: {
    postalCode: string; street: string; number: string; complement?: string;
    district: string; city: string; state: string;
  };
  cpfConfigured: boolean;
  itemCount: number;
};

const brazilianStates = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
]);

export function checkoutMissingFields(input: CheckoutReadinessInput): CheckoutRequiredField[] {
  const missing: CheckoutRequiredField[] = [];
  const { customer, address } = input;
  const name = customer.name.trim();
  if (name.length < 3 || name.length > 120) missing.push("name");
  if (!isValidCustomerEmail(customer.email)) missing.push("email");
  if (!isValidBrazilianPhone(customer.phone)) missing.push("phone");
  if (!input.cpfConfigured && !isValidCpf(customer.cpf)) missing.push("cpf");
  if (!/^\d{5}-?\d{3}$/u.test(address.postalCode.trim())) missing.push("postalCode");
  const street = address.street.trim();
  if (street.length < 3 || street.length > 160) missing.push("street");
  const number = address.number.trim();
  if (!number || number.length > 20) missing.push("number");
  const district = address.district.trim();
  if (district.length < 2 || district.length > 100) missing.push("district");
  const city = address.city.trim();
  if (city.length < 2 || city.length > 100) missing.push("city");
  if (!brazilianStates.has(address.state.trim().toUpperCase())) missing.push("state");
  if (!Number.isSafeInteger(input.itemCount) || input.itemCount < 1) missing.push("items");
  return missing;
}

export function normalizeOptionalCouponCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

export function isCancelledOrderStatus(status: string): boolean {
  return status === "cancellation_requested" || status === "cancelled";
}

export function shouldResumePendingCheckout(order: unknown, totals: unknown): boolean {
  return isUnknownRecord(order)
    && order.reused === true
    && isUnknownRecord(totals)
    && totals.status === "pending_payment"
    && totals.payment_status === "pending";
}
