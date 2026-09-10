import { isUnknownRecord } from "./unknown-data";

export type MercadoPagoBrickSession = {
  orderId: string;
  orderCode: string;
  subtotalInCents: number;
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
  const { orderId, orderCode, subtotalInCents, shippingInCents, amountInCents, publicKey } = value;
  if (
    typeof orderId !== "string" || !orderId ||
    typeof orderCode !== "string" || !orderCode ||
    typeof publicKey !== "string" || !publicKey.startsWith("TEST-") ||
    !positiveSafeInteger(subtotalInCents) ||
    !positiveSafeInteger(shippingInCents) ||
    !positiveSafeInteger(amountInCents) ||
    shippingInCents !== expectedShippingInCents ||
    amountInCents !== subtotalInCents + shippingInCents
  ) return null;

  return {
    orderId,
    orderCode,
    subtotalInCents,
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
      identification: { type: "CPF", number: session.cpf }
    }
  };
}
