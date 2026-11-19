import "server-only";
import { z } from "zod";

const pointMethods = z.enum(["pix", "debit_card", "credit_card"]);
const centAmount = z.string().regex(/^\d{1,13}(?:\.\d{1,2})?$/u);
const orderIdSchema = z.string().regex(/^ORD[A-Za-z0-9]{12,62}$/u);
const pointOrder = z.object({
  id: orderIdSchema,
  external_reference: z.string(),
  user_id: z.union([z.string(), z.number()]).transform(String),
  type: z.literal("point"),
  country_code: z.enum(["BR", "BRA"]),
  currency: z.literal("BRL").optional(),
  status: z.enum(["created", "at_terminal", "processed", "failed", "expired", "canceled", "action_required", "refunded"]),
  config: z.object({
    point: z.object({ terminal_id: z.string() }),
    payment_method: z.object({ default_type: z.string() })
  }),
  transactions: z.object({
    payments: z.array(z.object({
      id: z.string().regex(/^PAY[A-Za-z0-9]{12,62}$/u),
      amount: centAmount,
      paid_amount: centAmount.optional(),
      status: z.string(),
      payment_method: z.object({ type: z.string(), id: z.string() }).optional()
    })).length(1),
    refunds: z.array(z.object({
      id: z.string().regex(/^REF[A-Za-z0-9]{12,62}$/u), transaction_id: z.string(),
      amount: centAmount, status: z.string()
    })).optional()
  })
});

export const representativePointIntent = z.object({
  pointOrderId: orderIdSchema.nullable(),
  pointKey: z.string().uuid(),
  method: pointMethods,
  terminal: z.string().regex(/^[A-Za-z0-9_]{4,80}$/u),
  amountInCents: z.number().int().positive().max(999_999_999_999),
  confirmed: z.boolean()
});

type PointIntent = z.infer<typeof representativePointIntent>;
type PointOrder = z.infer<typeof pointOrder>;
const methodType = (method: PointIntent["method"]) => method === "pix" ? "qr" : method;

function verifyPointIdentity(order: PointOrder, intent: PointIntent, collector: string) {
  const payment = order.transactions.payments[0];
  if (!payment || order.external_reference !== `KITMG-POS-${intent.pointKey}` || order.user_id !== collector
    || order.config.point.terminal_id !== intent.terminal || order.config.payment_method.default_type !== methodType(intent.method)
    || (intent.pointOrderId && order.id !== intent.pointOrderId)
    || Math.round(Number(payment.amount) * 100) !== intent.amountInCents) throw new Error("O recebimento no Point não corresponde ao pedido.");
  return payment;
}

function assertPointPaymentAmount(payment: ReturnType<typeof verifyPointIdentity>, intent: PointIntent) {
  const approvedMethod = intent.method === "pix"
    ? payment.payment_method?.id === "pix"
    : payment.payment_method?.type === intent.method;
  if (!approvedMethod || !payment.paid_amount
    || Math.round(Number(payment.paid_amount) * 100) !== intent.amountInCents) {
    throw new Error("A confirmação do Point requer conciliação.");
  }
}

function verifyPointOrder(order: PointOrder, intent: PointIntent, collector: string) {
  const payment = verifyPointIdentity(order, intent, collector);
  if (order.status !== "processed") return { id: order.id, status: order.status, receipt: null };
  assertPointPaymentAmount(payment, intent);
  if (payment.status !== "processed") throw new Error("A confirmação do Point requer conciliação.");
  return { id: order.id, status: order.status, receipt: payment.id };
}

export async function reconcileRepresentativePoint(
  transport: typeof fetch,
  credentials: { accessToken: string; collector: string },
  intent: PointIntent,
  operation: "launch" | "refresh" | "cancel"
) {
  if (!intent.pointOrderId && operation !== "launch") throw new Error("Envie o pedido ao terminal antes de conciliar.");
  const base = "https://api.mercadopago.com/v1/orders";
  const headers = { authorization: `Bearer ${credentials.accessToken}`, accept: "application/json",
    "content-type": "application/json", "x-idempotency-key": operation === "cancel" ? `${intent.pointKey}-cancel` : intent.pointKey };
  const request = (url: string, init: RequestInit) => transport(url, {
    ...init, headers: { ...headers, ...init.headers }, redirect: "error", signal: AbortSignal.timeout(12_000)
  });
  let result: Response;
  if (!intent.pointOrderId) {
    result = await request(base, { method: "POST", body: JSON.stringify({
      type: "point", external_reference: `KITMG-POS-${intent.pointKey}`, expiration_time: "PT10M",
      transactions: { payments: [{ amount: (intent.amountInCents / 100).toFixed(2) }] },
      config: { point: { terminal_id: intent.terminal }, payment_method: { default_type: methodType(intent.method),
        ...(intent.method === "credit_card" ? { default_installments: 1 } : {}) } }
    }) });
  } else {
    const url = `${base}/${intent.pointOrderId}`;
    if (operation === "cancel") {
      const canceled = await request(`${url}/cancel`, { method: "POST", headers: { "x-allow-cancelable-status": "at_terminal" } });
      if (!canceled.ok && canceled.status !== 409) throw new Error("O cancelamento no Point precisa ser conferido.");
    }
    result = await request(url, { method: "GET" });
  }
  if (!result.ok) throw new Error("Não foi possível confirmar o recebimento no Point.");
  return verifyPointOrder(pointOrder.parse(await result.json()), intent, credentials.collector);
}

export const representativePointRefund = representativePointIntent.omit({ confirmed: true }).extend({
  pointOrderId: orderIdSchema,
  confirmed: z.literal(false),
  refundId: z.string().uuid(),
  refundCents: z.number().int().positive().max(999_999_999_999),
  receipt: z.string().regex(/^PAY[A-Za-z0-9]{12,62}$/u),
  maySend: z.boolean(),
  previousRefundIds: z.array(z.string().regex(/^REF[A-Za-z0-9]{12,62}$/u)).max(100)
});

export async function reconcileRepresentativePointRefund(
  transport: typeof fetch,
  credentials: { accessToken: string; collector: string },
  intent: z.infer<typeof representativePointRefund>
): Promise<string | null> {
  const url = `https://api.mercadopago.com/v1/orders/${intent.pointOrderId}`;
  const request = (endpoint: string, init: RequestInit) => transport(endpoint, {
    ...init, redirect: "error", signal: AbortSignal.timeout(12_000),
    headers: { authorization: `Bearer ${credentials.accessToken}`, accept: "application/json",
      "content-type": "application/json", "x-idempotency-key": intent.refundId }
  });
  async function readOrder() {
    const response = await request(url, { method: "GET" });
    if (!response.ok) throw new Error("Não foi possível conciliar o estorno do Point.");
    const current = pointOrder.parse(await response.json());
    const payment = verifyPointIdentity(current, intent, credentials.collector);
    assertPointPaymentAmount(payment, intent);
    if (payment.id !== intent.receipt) throw new Error("A transação do Point não corresponde ao estorno.");
    const refunds = current.transactions.refunds ?? [];
    const known = new Set(intent.previousRefundIds);
    if (refunds.some(refund => known.has(refund.id) && (refund.status !== "processed" || refund.transaction_id !== payment.id))
      || intent.previousRefundIds.some(id => !refunds.some(refund => refund.id === id))) {
      throw new Error("Há divergências nos estornos anteriores.");
    }
    const newRefunds = refunds.filter(refund => !known.has(refund.id));
    if (newRefunds.some(refund => refund.transaction_id !== payment.id || Math.round(Number(refund.amount) * 100) !== intent.refundCents)
      || newRefunds.length > 1) throw new Error("Há um estorno do Point que requer conciliação.");
    const prior = refunds.filter(refund => known.has(refund.id)).reduce((sum, refund) => sum + Math.round(Number(refund.amount) * 100), 0);
    if (prior + intent.refundCents > intent.amountInCents) throw new Error("O estorno supera o total recebido.");
    return { current, prior, newRefund: newRefunds[0] };
  }
  const before = await readOrder();
  if (before.newRefund) return before.newRefund.status === "processed" ? before.newRefund.id : null;
  if (!intent.maySend || before.current.status !== "processed") return null;
  const partial = before.prior > 0 || intent.refundCents < intent.amountInCents;
  const sent = await request(`${url}/refund`, { method: "POST",
    ...(partial ? { body: JSON.stringify({ transactions: [{ id: intent.receipt, amount: (intent.refundCents / 100).toFixed(2) }] }) } : {}) });
  if (!sent.ok && sent.status !== 409) throw new Error("O estorno do Point precisa ser conferido.");
  const { newRefund } = await readOrder();
  return newRefund?.status === "processed" ? newRefund.id : null;
}
