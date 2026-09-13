import { isUnknownRecord } from "./unknown-data";
import { readMercadoPagoPayerDocument, type MercadoPagoPaymentMode } from "./mercadopago-payer-identity";

export type MercadoPagoBrickSession = {
  orderId: string;
  orderCode: string;
  subtotalInCents: number;
  discountInCents: number;
  couponName: string;
  shippingInCents: number;
  amountInCents: number;
  publicKey: string;
  paymentMode: MercadoPagoPaymentMode;
  idempotencyKey: string;
  email: string;
  checkout: CheckoutConfirmationPayload | null;
  savedCards?: { customerId: string; cardIds: string[] };
};

export type CheckoutConfirmationPayload = {
  couponCode?: string;
  customer: { name: string; email: string; phone: string; cpf: string };
  address: {
    postalCode: string; street: string; number: string; complement: string;
    district: string; city: string; state: string;
  };
  lines: Array<{
    productId: string; variantId: string; color: string; size: string; quantity: number;
  }>;
};

const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function readMercadoPagoBrickSession(
  value: unknown,
  identity: Pick<MercadoPagoBrickSession, "idempotencyKey" | "email" | "checkout">,
  expectedShippingInCents: number
): MercadoPagoBrickSession | null {
  if (!isUnknownRecord(value) || value.ok !== true || value.paymentMode !== "test") return null;
  const { subtotalInCents, discountInCents, couponName, shippingInCents, amountInCents, publicKey } = value;
  if (
    typeof publicKey !== "string" || !publicKey.startsWith("TEST-") ||
    !positiveSafeInteger(subtotalInCents) ||
    typeof discountInCents !== "number" || !Number.isSafeInteger(discountInCents) || discountInCents < 0 ||
    typeof couponName !== "string" ||
    !positiveSafeInteger(shippingInCents) ||
    !positiveSafeInteger(amountInCents) ||
    shippingInCents !== expectedShippingInCents ||
    amountInCents !== subtotalInCents - discountInCents + shippingInCents
  ) return null;

  return {
    orderId: "",
    orderCode: "",
    subtotalInCents,
    discountInCents,
    couponName,
    shippingInCents,
    amountInCents,
    publicKey,
    paymentMode: "test",
    ...identity
  };
}

export function createMercadoPagoInitialization(session: MercadoPagoBrickSession) {
  if (!positiveSafeInteger(session.amountInCents)) return null;
  return {
    amount: session.amountInCents / 100,
    payer: {
      email: session.email,
      entityType: "individual" as const,
      ...(session.savedCards?.customerId && session.savedCards.cardIds.length
        ? { customerId: session.savedCards.customerId, cardsIds: session.savedCards.cardIds } : {}),
    }
  };
}

export function createCheckoutPaymentPayload(
  formData: unknown,
  session: Pick<MercadoPagoBrickSession, "paymentMode">
) {
  if (!isUnknownRecord(formData)) return null;
  const paymentMethodId = formData.payment_method_id;
  if (typeof paymentMethodId !== "string" || !paymentMethodId.trim()) return null;

  const installments = Number(formData.installments ?? 1);
  if (!Number.isInteger(installments) || installments < 1 || installments > 48) return null;

  const token = typeof formData.token === "string" && formData.token.trim()
    ? formData.token.trim()
    : undefined;
  const issuerId = typeof formData.issuer_id === "string" || typeof formData.issuer_id === "number"
    ? formData.issuer_id
    : undefined;
  const payer = isUnknownRecord(formData.payer) ? formData.payer : {};
  const savedCustomerId = payer.type === "customer" && typeof payer.id === "string"
    && /^[a-zA-Z0-9_+-]{1,100}$/u.test(payer.id) ? payer.id : "";
  if (payer.type === "customer" && (!savedCustomerId || !token)) return null;
  const identification = isUnknownRecord(payer.identification) ? payer.identification : {};
  if (identification.type !== undefined && identification.type !== "CPF") return null;
  const suppliedDocument = typeof identification.number === "string" && identification.number.trim()
    ? identification.number.trim() : null;
  // Missing identification is resolved from private customer identity by the backend.
  const document = suppliedDocument ? readMercadoPagoPayerDocument(suppliedDocument, session.paymentMode) : null;
  if (suppliedDocument && !document) return null;

  return {
    payment_method_id: paymentMethodId.trim(),
    installments,
    payer: {
      entity_type: "individual" as const,
      ...(savedCustomerId ? { type: "customer" as const, id: savedCustomerId } : {}),
      ...(document ? { identification: { type: "CPF" as const, number: document } } : {})
    },
    ...(token ? { token } : {}),
    ...(issuerId !== undefined ? { issuer_id: issuerId } : {})
  };
}
