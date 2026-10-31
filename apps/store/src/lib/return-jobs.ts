import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getMercadoPagoCredentials, getResendReadiness } from "@curtiz/config";
import { MercadoPagoPaymentProvider, sendTransactionalEmail } from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";
import { isUnknownRecord, readNumber, readString } from "./unknown-data";

type Environment = Readonly<Record<string, string | undefined>>;

export async function processReturnRefund(db: SupabaseClient, job: Record<string, unknown>, environment: Environment, transport: typeof fetch) {
  const credentials = getMercadoPagoCredentials(environment);
  if (!credentials) throw new Error("return_payment_configuration");
  const mode = await db.rpc("check_mercadopago_order_mode", { p_mode: credentials.mode,
    p_order_id: readString(job, "orderId"), p_customer_id: readString(job, "customerId") });
  if (mode.error || mode.data !== true) throw new Error("return_payment_mode_mismatch");
  const provider = new MercadoPagoPaymentProvider(credentials.accessToken, credentials.mode, transport);
  const paymentId = readString(job, "paymentId");
  const payment = await provider.getPayment(paymentId);
  const known = Array.isArray(job.knownRefundIds) ? job.knownRefundIds.filter((id): id is string => typeof id === "string") : [];
  const amount = readNumber(job, "amountInCents");
  const receipt = readString(job, "providerId");
  if (receipt) {
    const confirmed = payment.refunds.find(refund => refund.id === receipt && refund.amountInCents === amount && ["approved", "completed"].includes(refund.status));
    if (payment.id !== paymentId || payment.externalReference !== readString(job, "orderCode") || payment.currency !== "BRL"
      || payment.amountInCents !== readNumber(job, "paymentAmountInCents") || !Number.isSafeInteger(amount) || amount <= 0 || !confirmed)
      throw new Error("return_receipt_requires_review");
    return { id: confirmed.id };
  }
  if (payment.id !== paymentId || payment.externalReference !== readString(job, "orderCode") || payment.currency !== "BRL"
    || payment.amountInCents !== readNumber(job, "paymentAmountInCents") || payment.status !== "approved"
    || !Number.isSafeInteger(amount) || amount <= 0 || payment.refunds.some(refund => !known.includes(refund.id))
    || payment.refunds.some(refund => !["approved", "completed"].includes(refund.status))
    || amount + payment.refunds.reduce((sum, refund) => sum + refund.amountInCents, 0) > payment.amountInCents)
    throw new Error("return_payment_requires_review");
  return provider.refundPayment(paymentId, amount, readString(job, "idempotencyKey"));
}

export function returnNotificationPayload(job: Record<string, unknown>, settings: { from: string; replyTo: string }, storeUrl: string) {
  const origin = new URL(storeUrl);
  const email = readString(job, "email");
  const code = readString(job, "code");
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password
    || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email) || !/^DEV-[A-Z0-9]+$/u.test(code)) throw new Error("return_email_configuration");
  const link = `${origin.origin}/minha-conta/trocas`;
  const subject = `Atualização da solicitação ${code} · curti Z`;
  return { from: settings.from, reply_to: settings.replyTo, to: [email], subject,
    tags: [{ name: "kind", value: "return_update" }],
    text: `Há uma atualização na sua solicitação ${code}. Acesse sua conta para consultar a etapa, as orientações da equipe e o acompanhamento do reembolso, quando aplicável.\n\n${link}`,
    html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${subject}</title></head><body style="font-family:Arial,sans-serif;color:#242424;font-size:16px;line-height:1.6"><h1 style="color:#62130f;font-size:24px">Atualização da sua solicitação</h1><p>Há uma atualização na solicitação <strong>${code}</strong>.</p><p>Consulte a etapa e as orientações da equipe na sua conta.</p><p><a href="${link}" style="display:inline-block;padding:16px 24px;background:#62130f;color:white">Acompanhar solicitação</a></p></body></html>` };
}

export async function runReturnJobs(environment: Environment, executionId: string, transport: typeof fetch = fetch) {
  const secret = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  let origin: URL;
  try { origin = new URL(environment.SUPABASE_URL ?? ""); } catch { return; }
  if (!secret || origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) return;
  const db = createClient(origin.origin, secret, { global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false } });
  const email = getResendReadiness({ ...environment, EMAIL_ENABLED: environment.RETURNS_EMAIL_ENABLED ?? "false" });
  for (const kind of ["refund", "email"] as const) {
    if (kind === "email" && !email.configured) continue;
    const lock = crypto.randomUUID();
    const claimed = await db.rpc("claim_return_job", { p_kind: kind, p_lock_id: lock });
    if (claimed.error) throw new Error("return_queue_unavailable");
    if (!isUnknownRecord(claimed.data)) continue;
    const job = claimed.data;
    let providerId = "";
    try {
      providerId = kind === "refund" ? (await processReturnRefund(db, job, environment, transport)).id
        : await sendTransactionalEmail(environment.RESEND_API_KEY ?? "", returnNotificationPayload(job, email,
          environment.NEXT_PUBLIC_STORE_URL ?? ""), readString(job, "idempotencyKey"), transport);
      const finished = await db.rpc("finish_return_job", { p_job_id: readString(job, "id"), p_lock_id: lock,
        p_outcome: "completed", p_provider_id: providerId });
      if (finished.error || finished.data !== true) throw new Error("return_receipt_not_saved");
    } catch {
      // A failed/uncertain write is visible for reconciliation and must never be charged again automatically.
      await db.rpc("finish_return_job", { p_job_id: readString(job, "id"), p_lock_id: lock, p_outcome: "review",
        p_provider_id: providerId || null, p_error: kind === "refund" ? "refund_requires_review" : "email_requires_review" });
      logServerEvent("error", "return_job_requires_review", { executionId, kind, jobId: readString(job, "id") });
    }
  }
}
