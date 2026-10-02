import "server-only";
import { BlingError } from "./bling";

/** Provider acceptance is separate from actual mail delivery. */
export async function sendInvoiceEmail(input: { apiKey: string; from: string; to: string;
  orderCode: string; storeUrl: string; idempotencyKey: string }, transport: typeof fetch = fetch): Promise<string> {
  let origin: URL;
  try { origin = new URL(input.storeUrl); } catch { throw new BlingError("email_configuration", 503); }
  const email = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;
  if (!input.apiKey || !email.test(input.from) || !email.test(input.to) || origin.protocol !== "https:"
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
    || !/^[a-zA-Z0-9:_-]{1,200}$/u.test(input.idempotencyKey)) throw new BlingError("email_configuration", 503);
  const response = await transport("https://api.resend.com/emails", { method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json", "idempotency-key": input.idempotencyKey },
    body: JSON.stringify({ from: input.from, to: [input.to], subject: `Nota fiscal disponível · ${input.orderCode}`,
      text: `A nota fiscal do pedido ${input.orderCode} está disponível. Entre na sua conta para consultar o pedido e baixar o documento: ${origin.origin}/minha-conta` }),
    signal: AbortSignal.timeout(10_000)
  }).catch(() => { throw new BlingError("email_acceptance_uncertain", 503, false, true); });
  if (!response.ok) throw new BlingError(response.status >= 500 ? "email_acceptance_uncertain" : "email_rejected", response.status,
    response.status === 429, response.status >= 500);
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id)
    throw new BlingError("email_acceptance_uncertain", 502, false, true);
  return result.id;
}
