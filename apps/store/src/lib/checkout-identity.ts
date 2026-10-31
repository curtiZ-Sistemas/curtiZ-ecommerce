import "server-only";
import { decryptPII, encryptPII } from "./pii";
import { isValidCpf, sanitizeCpf } from "./personal-data";
import { readMercadoPagoPayerDocument, type MercadoPagoPaymentMode } from "./mercadopago-payer-identity";
import { isUnknownRecord } from "./unknown-data";

type IdentityDb = {
  rpc(name: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>;
};

export class CheckoutIdentityError extends Error {
  constructor(readonly code = "CUSTOMER_IDENTITY_UNAVAILABLE", readonly status = 503) { super(code); }
}

/** customerId must come from the verified server session, never request JSON. */
export async function saveCustomerCheckoutIdentity(db: IdentityDb, customerId: string, value: string) {
  if (!isValidCpf(value)) throw new CheckoutIdentityError("INVALID_CUSTOMER_CPF", 400);
  const cpf = sanitizeCpf(value);
  try {
    const { data, error } = await db.rpc("save_customer_checkout_identity", {
      p_customer_id: customerId, p_cpf_ciphertext: encryptPII(cpf), p_cpf_last_four: cpf.slice(-4)
    });
    if (error || data !== true) throw new Error();
    return cpf.slice(-4);
  } catch {
    throw new CheckoutIdentityError();
  }
}

export async function readCustomerCheckoutCpf(db: IdentityDb, customerId: string) {
  try {
    const { data, error } = await db.rpc("get_customer_checkout_identity", { p_customer_id: customerId });
    if (error) throw new Error();
    if (data === null) throw new CheckoutIdentityError("CUSTOMER_IDENTITY_REQUIRED", 409);
    if (!isUnknownRecord(data) || data.customerId !== customerId || typeof data.cpfCiphertext !== "string"
      || typeof data.cpfLastFour !== "string" || !/^\d{4}$/u.test(data.cpfLastFour)) throw new Error();
    const cpf = decryptPII(data.cpfCiphertext);
    if (!/^\d{11}$/u.test(cpf) || !isValidCpf(cpf) || !cpf.endsWith(data.cpfLastFour)) throw new Error();
    return cpf;
  } catch (error) {
    if (error instanceof CheckoutIdentityError) throw error;
    throw new CheckoutIdentityError();
  }
}

export async function resolveCheckoutPayerDocument(
  db: IdentityDb, customerId: string, supplied: string, mode: MercadoPagoPaymentMode
) {
  const document = supplied.trim() ? readMercadoPagoPayerDocument(supplied, mode) : null;
  if (supplied.trim() && !document) throw new CheckoutIdentityError("INVALID_PAYER_DOCUMENT", 400);
  // TEST identification belongs only to the provider and never updates customer identity.
  if (mode === "test" && document) return document;
  const customerCpf = await readCustomerCheckoutCpf(db, customerId);
  if (document && document !== customerCpf) throw new CheckoutIdentityError("INVALID_PAYER_DOCUMENT", 400);
  return customerCpf;
}
