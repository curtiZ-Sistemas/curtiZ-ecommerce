import { isUnknownRecord } from "./unknown-data";

export type MercadoPagoBrickSession = {
  orderId: string;
  orderCode: string;
  subtotalInCents: number;
  discountInCents: number;
  couponName: string;
  shippingInCents: number;
  amountInCents: number;
  publicKey: string;
  idempotencyKey: string;
  email: string;
  cpf: string;
};

const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function readMercadoPagoBrickSession(
  value: unknown,
  identity: Pick<MercadoPagoBrickSession, "idempotencyKey" | "email" | "cpf">,
  expectedShippingInCents: number
): MercadoPagoBrickSession | null {
  if (!isUnknownRecord(value) || value.ok !== true || value.paymentMode !== "test") return null;
  const { orderId, orderCode, subtotalInCents, discountInCents, couponName, shippingInCents, amountInCents, publicKey } = value;
  if (
    typeof orderId !== "string" || !orderId ||
    typeof orderCode !== "string" || !orderCode ||
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
    orderId,
    orderCode,
    subtotalInCents,
    discountInCents,
    couponName,
    shippingInCents,
    amountInCents,
    publicKey,
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
      ...(session.cpf ? { identification: { type: "CPF", number: session.cpf } } : {})
    }
  };
}

export function createCheckoutPaymentPayload(
  formData: unknown,
  session: Pick<MercadoPagoBrickSession, "cpf">
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
  const identification = isUnknownRecord(payer.identification) ? payer.identification : {};
  const document = typeof identification.number === "string" && identification.number.trim()
    ? identification.number.trim() : session.cpf;

  return {
    payment_method_id: paymentMethodId.trim(),
    installments,
    payer: {
      entity_type: "individual" as const,
      identification: { type: "CPF" as const, number: document }
    },
    ...(token ? { token } : {}),
    ...(issuerId !== undefined ? { issuer_id: issuerId } : {})
  };
}
