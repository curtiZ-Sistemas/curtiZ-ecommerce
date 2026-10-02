import "server-only";

export type EmailKind = "purchase_confirmed" | "review_requested";
export type EmailPayload = { from: string; to: string[]; reply_to: string; subject: string; html: string; text: string;
  tags: { name: string; value: string }[] };
export type EmailOrder = { code: string; name: string; email: string; subtotal: number; discount: number;
  shipping: number; fees: number; total: number; address: string;
  items: { name: string; color: string; size: string; quantity: number; unitPrice: number; total: number }[] };
const escape = (value: string) => value.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function renderTransactionalEmail(input: { kind: EmailKind; order: EmailOrder; from: string; replyTo: string; storeUrl: string; messageId: string }): EmailPayload {
  const { kind, order } = input;
  const origin = new URL(input.storeUrl);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password)
    throw new EmailError("email_configuration");
  if (!order.code || !order.items.length || [order.subtotal, order.discount, order.shipping, order.fees, order.total,
    ...order.items.flatMap((item) => [item.unitPrice, item.total])].some((amount) => !Number.isFinite(amount) || amount < 0)
    || order.items.some((item) => !item.name || !Number.isSafeInteger(item.quantity) || item.quantity < 1))
    throw new EmailError("invalid_order_snapshot");
  const purchase = kind === "purchase_confirmed";
  const title = purchase ? "Compra confirmada" : "Como foi sua compra?";
  const introduction = purchase ? "Seu pagamento foi aprovado. Confira os detalhes do seu pedido."
    : "Obrigada por comprar na curti Z! Seu pedido foi entregue. Conte o que achou dos produtos recebidos.";
  const action = purchase ? "Acompanhar pedido" : "Avaliar compra";
  const link = `${origin.origin}/minha-conta/${purchase ? "pedidos" : "avaliacoes"}`;
  const greeting = order.name ? `Olá, ${order.name}!` : "Olá!";
  const lines = order.items.map((item) => `${item.name} · ${item.color} · ${item.size} · Quantidade: ${item.quantity}${purchase ? ` · ${money(item.unitPrice)} por unidade · ${money(item.total)}` : ""}`);
  const totals = purchase ? [
    `Produtos: ${money(order.subtotal)}`, ...(order.discount ? [`Desconto: −${money(order.discount)}`] : []),
    `Frete: ${money(order.shipping)}`, ...(order.fees ? [`Taxas: ${money(order.fees)}`] : []), `Total: ${money(order.total)}`
  ] : [];
  const address = purchase && order.address ? `Entrega: ${order.address}` : "";
  const content = `<h1 style="font-size:26px;line-height:1.25;margin:0 0 24px;color:#62130f">${title}</h1><p>${escape(greeting)}</p><p>${introduction}</p><p><strong>Pedido ${escape(order.code)}</strong></p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${lines.map((line) => `<tr><td style="padding:16px 0;border-bottom:1px solid #eeeeee;overflow-wrap:anywhere">${escape(line)}</td></tr>`).join("")}</table>
    ${totals.map((line) => `<p style="margin:12px 0">${escape(line)}</p>`).join("")}${address ? `<p>${escape(address)}</p>` : ""}
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td bgcolor="#62130f" style="border-radius:4px"><a href="${escape(link)}" style="display:inline-block;padding:16px 24px;color:#ffffff;font-weight:700;text-decoration:none">${action}</a></td></tr></table>
    <p style="font-size:13px">Se necessário, entre na sua conta para continuar.</p>`;
  return { from: input.from, to: [order.email], reply_to: input.replyTo, subject: `${title} · ${order.code}`,
    tags: [{ name: "curtiz_message", value: input.messageId }, { name: "kind", value: kind }],
    text: ["curti Z", title, greeting, introduction, `Pedido ${order.code}`, ...lines, ...totals, address,
      `${action}: ${link}`, "Se necessário, entre na sua conta para continuar.", `Dúvidas? Responda para ${input.replyTo}.`].filter(Boolean).join("\n\n"),
    html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
      <body style="margin:0;background:#eeeeee;color:#242424;font-family:Manrope,Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#eeeeee"><tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;table-layout:fixed"><tr><td style="padding:24px;color:#62130f;font-size:24px;font-weight:800"><img src="${escape(origin.origin)}/images/optimized/logo.webp" width="140" height="93" alt="curti Z" style="display:block;max-width:100%;height:auto;border:0"></td></tr><tr><td style="padding:0 24px 24px;overflow-wrap:anywhere">${content}</td></tr>
      <tr><td style="padding:24px;border-top:1px solid #eeeeee;font-size:13px">curti Z · E-mail sobre seu pedido.<br>Dúvidas? <a style="color:#62130f" href="mailto:${escape(input.replyTo)}">${escape(input.replyTo)}</a></td></tr></table></td></tr></table></body></html>` };
}

export class EmailError extends Error {
  constructor(readonly code: string, readonly retryable = false, readonly uncertain = false, readonly retryAfterSeconds = 0) {
    super(code); this.name = "EmailError";
  }
}

async function request(apiKey: string, path: string, init: RequestInit, transport: typeof fetch): Promise<Record<string, unknown>> {
  if (!apiKey.trim()) throw new EmailError("email_configuration");
  const write = init.method === "POST";
  const response = await transport(`https://api.resend.com${path}`, { ...init,
    headers: { ...init.headers, authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(10_000), redirect: "error"
  }).catch(() => { throw new EmailError(write ? "email_acceptance_uncertain" : "email_status_unavailable", true, write); });
  const data: unknown = await response.json().catch(() => null);
  const record = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  if (!response.ok) {
    const concurrent = response.status === 409 && record.name === "concurrent_idempotent_requests";
    const temporary = response.status === 429 || response.status >= 500 || concurrent;
    const delay = response.headers.get("retry-after");
    const seconds = delay && /^\d+$/u.test(delay) ? Number(delay) : delay ? Math.ceil((Date.parse(delay) - Date.now()) / 1000) : 0;
    throw new EmailError(response.status === 429 ? "email_rate_limited" : write && response.status >= 500 ? "email_acceptance_uncertain" : "email_provider_rejected",
      temporary, write && (response.status >= 500 || concurrent), Math.min(Math.max(seconds || 0, 0), 86400));
  }
  return record;
}

export async function sendTransactionalEmail(apiKey: string, payload: EmailPayload, idempotencyKey: string, transport: typeof fetch = fetch): Promise<string> {
  const result = await request(apiKey, "/emails", { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(payload) }, transport);
  if (typeof result.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/u.test(result.id)) throw new EmailError("email_acceptance_uncertain", true, true);
  return result.id;
}

export async function getTransactionalEmailStatus(apiKey: string, providerId: string, transport: typeof fetch = fetch): Promise<string> {
  const result = await request(apiKey, `/emails/${encodeURIComponent(providerId)}`, { method: "GET" }, transport);
  if (result.id !== providerId || typeof result.last_event !== "string") throw new EmailError("email_status_unavailable", true);
  return ["delivered", "bounced", "complained", "failed", "suppressed", "delivery_delayed", "sent", "queued", "opened", "clicked"].includes(result.last_event)
    ? result.last_event : "unknown";
}
