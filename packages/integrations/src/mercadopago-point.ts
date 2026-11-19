import "server-only";

const pointStatuses = ["created", "at_terminal", "processed", "failed", "expired", "canceled", "action_required", "refunded"] as const;
type PointStatus = (typeof pointStatuses)[number];
type PointMethod = "pix" | "debit_card" | "credit_card";
export type RepresentativePointIntent = {
  pointOrderId: string | null;
  pointKey: string;
  method: PointMethod;
  terminal: string;
  amountInCents: number;
  confirmed: boolean;
};
export type RepresentativePointRefundIntent = RepresentativePointIntent & {
  pointOrderId: string;
  confirmed: false;
  refundId: string;
  refundCents: number;
  receipt: string;
  maySend: boolean;
  previousRefundIds: string[];
};

const invalid = () => new Error("Resposta inválida do Point.");
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const isStatus = (value: unknown): value is PointStatus =>
  typeof value === "string" && pointStatuses.some(status => status === value);

function amountInCents(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,13}(?:\.\d{1,2})?$/u.test(value)) throw invalid();
  const [reais = "", cents = ""] = value.split(".");
  const result = Number(reais) * 100 + Number(cents.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw invalid();
  return result;
}

function readPointOrder(value: unknown) {
  const order = object(value);
  const config = object(order?.config);
  const point = object(config?.point);
  const configuredMethod = object(config?.payment_method);
  const transactions = object(order?.transactions);
  const payments = transactions?.payments;
  if (!order || order.type !== "point" || !isStatus(order.status)
    || (order.country_code !== "BR" && order.country_code !== "BRA")
    || (order.currency !== undefined && order.currency !== "BRL")
    || typeof order.id !== "string" || !/^ORD[A-Za-z0-9]{12,62}$/u.test(order.id)
    || typeof order.external_reference !== "string"
    || !(typeof order.user_id === "string" || Number.isSafeInteger(order.user_id))
    || typeof point?.terminal_id !== "string" || typeof configuredMethod?.default_type !== "string"
    || !Array.isArray(payments) || payments.length !== 1) throw invalid();

  const payment = object(payments[0]);
  const method = object(payment?.payment_method);
  if (!payment || typeof payment.id !== "string" || !/^PAY[A-Za-z0-9]{12,62}$/u.test(payment.id)
    || typeof payment.status !== "string") throw invalid();
  const refundValues = transactions?.refunds;
  if (refundValues !== undefined && (!Array.isArray(refundValues) || refundValues.length > 100)) throw invalid();
  const refunds = Array.isArray(refundValues) ? refundValues.map((value: unknown) => {
    const refund = object(value);
    if (!refund || typeof refund.id !== "string" || !/^REF[A-Za-z0-9]{12,62}$/u.test(refund.id)
      || typeof refund.transaction_id !== "string" || typeof refund.status !== "string") throw invalid();
    return { id: refund.id, paymentId: refund.transaction_id, status: refund.status, amount: amountInCents(refund.amount) };
  }) : [];
  return { id: order.id, reference: order.external_reference, collector: String(order.user_id), status: order.status,
    terminal: point.terminal_id, configuredMethod: configuredMethod.default_type,
    payment: { id: payment.id, status: payment.status, amount: amountInCents(payment.amount),
      paid: payment.paid_amount === undefined ? null : amountInCents(payment.paid_amount),
      methodId: method?.id, methodType: method?.type },
    refunds };
}

type PointIntent = RepresentativePointIntent;
type PointOrder = ReturnType<typeof readPointOrder>;
const methodType = (method: PointIntent["method"]) => method === "pix" ? "qr" : method;

function verifyPointIdentity(order: PointOrder, intent: PointIntent, collector: string) {
  const payment = order.payment;
  if (order.reference !== `KITMG-POS-${intent.pointKey}` || order.collector !== collector
    || order.terminal !== intent.terminal || order.configuredMethod !== methodType(intent.method)
    || (intent.pointOrderId && order.id !== intent.pointOrderId)
    || payment.amount !== intent.amountInCents) throw new Error("O recebimento no Point não corresponde ao pedido.");
  return payment;
}

function assertPointPaymentAmount(payment: ReturnType<typeof verifyPointIdentity>, intent: PointIntent) {
  const approvedMethod = intent.method === "pix"
    ? payment.methodId === "pix"
    : payment.methodType === intent.method;
  if (!approvedMethod || payment.paid !== intent.amountInCents) {
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
  return verifyPointOrder(readPointOrder(await result.json() as unknown), intent, credentials.collector);
}

export async function reconcileRepresentativePointRefund(
  transport: typeof fetch,
  credentials: { accessToken: string; collector: string },
  intent: RepresentativePointRefundIntent
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
    const current = readPointOrder(await response.json() as unknown);
    const payment = verifyPointIdentity(current, intent, credentials.collector);
    assertPointPaymentAmount(payment, intent);
    if (payment.id !== intent.receipt) throw new Error("A transação do Point não corresponde ao estorno.");
    const refunds = current.refunds;
    const known = new Set(intent.previousRefundIds);
    if (refunds.some(refund => known.has(refund.id) && (refund.status !== "processed" || refund.paymentId !== payment.id))
      || intent.previousRefundIds.some(id => !refunds.some(refund => refund.id === id))) {
      throw new Error("Há divergências nos estornos anteriores.");
    }
    const newRefunds = refunds.filter(refund => !known.has(refund.id));
    if (newRefunds.some(refund => refund.paymentId !== payment.id || refund.amount !== intent.refundCents)
      || newRefunds.length > 1) throw new Error("Há um estorno do Point que requer conciliação.");
    const prior = refunds.filter(refund => known.has(refund.id)).reduce((sum, refund) => sum + refund.amount, 0);
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
