import "server-only";
import { getResendReadiness } from "@curtiz/config";
import { EmailError, renderTransactionalEmail, sendTransactionalEmail, getTransactionalEmailStatus,
  type EmailOrder, type EmailPayload } from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isUnknownRecord, readString } from "./unknown-data";

type Environment = Readonly<Record<string, string | undefined>>;

// Runtime-only opt-in for a short, isolated test. Never claims customer jobs.
export async function runEmailHomologation(environment: Environment, executionId: string,
  transport: typeof fetch = fetch, now = Date.now()) {
  const recipient = environment.EMAIL_HOMOLOGATION_RECIPIENT?.trim() ?? "";
  const startedAt = environment.EMAIL_HOMOLOGATION_STARTED_AT?.trim() ?? "";
  const started = Date.parse(startedAt);
  const readiness = getResendReadiness(environment);
  if (environment.EMAIL_ENABLED?.trim().toLowerCase() !== "false"
    || environment.EMAIL_PROVIDER?.trim().toLowerCase() !== "resend"
    || readiness.missing.length || readiness.invalid.length
    || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/u.test(recipient)
    || !Number.isFinite(started) || started > now || now - started >= 15 * 60_000
    || new Date(started).toISOString() !== startedAt) return;

  const banner = "HOMOLOGAÇÃO: dados de exemplo. Não existe pedido, pagamento, entrega ou avaliação real.";
  const order: EmailOrder = { code: "TESTE-SEM-COMPRA", name: "Destinatário de homologação", email: recipient,
    subtotal: 0, discount: 0, shipping: 0, fees: 0, total: 0, address: "Sem entrega — exemplo de template",
    items: [{ name: "EXEMPLO — nenhum produto foi comprado", color: "Exemplo", size: "Exemplo", quantity: 1, unitPrice: 0, total: 0 }] };
  for (const kind of ["purchase_confirmed", "review_requested"] as const) {
    try {
      const messageId = `homologation_${kind}_${startedAt.replace(/\D/gu, "")}`;
      const payload = renderTransactionalEmail({ kind, order, from: readiness.from, replyTo: readiness.replyTo,
        storeUrl: environment.NEXT_PUBLIC_STORE_URL ?? "", messageId });
      payload.subject = `[HOMOLOGAÇÃO — SEM PEDIDO REAL] ${payload.subject}`;
      payload.text = `${banner}\n\n${payload.text}`;
      payload.html = payload.html.replace('<table role="presentation" width="100%"',
        `<p style="padding:16px;background:#fff4cc;color:#242424;font-family:Arial,sans-serif">${banner}</p><table role="presentation" width="100%"`);
      const providerId = await sendTransactionalEmail(environment.RESEND_API_KEY ?? "", payload,
        `curtiz:homologation:${startedAt}:${kind}`, transport);
      // Resend's account rate limit is shared by sending and receipt queries.
      await new Promise(resolve => setTimeout(resolve, 1_000));
      const lastEvent = await getTransactionalEmailStatus(environment.RESEND_API_KEY ?? "", providerId, transport);
      logServerEvent("info", "transactional_email_homologation_checked", { executionId, kind, providerId, lastEvent });
      await new Promise(resolve => setTimeout(resolve, 1_000));
    } catch (error) {
      logServerEvent("error", "transactional_email_homologation_failed", { executionId, kind,
        code: error instanceof EmailError ? error.code : "email_homologation_failed" });
    }
  }
}

async function call(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await db.rpc(name, args);
  if (result.error) {
    const code = isUnknownRecord(result.error) ? result.error.code : null;
    logServerEvent("error", "transactional_email_storage_request_failed", { rpc: name, status: result.status,
      databaseCode: typeof code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/u.test(code) ? code : "unknown" });
    throw new EmailError("email_storage_unavailable", true);
  }
  return result.data;
}
function database(environment: Environment, transport: typeof fetch): SupabaseClient | null {
  try {
    const url = new URL(environment.SUPABASE_URL ?? "");
    const key = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
    if (!key || url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return createClient(url.origin, key, { global: { fetch: transport }, auth: { autoRefreshToken: false, persistSession: false } });
  } catch { return null; }
}

export function emailOrderFromSource(source: unknown): EmailOrder {
  if (!isUnknownRecord(source) || !isUnknownRecord(source.order) || !Array.isArray(source.items)) throw new EmailError("invalid_order_snapshot");
  const order = source.order;
  const address = isUnknownRecord(order.shipping_address_snapshot) ? order.shipping_address_snapshot : {};
  const email = readString(order, "customer_email_snapshot");
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email)) throw new EmailError("invalid_order_recipient");
  const amount = (row: Record<string, unknown>, key: string): number => {
    const value = row[key];
    if ((typeof value !== "number" && typeof value !== "string") || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0)
      throw new EmailError("invalid_order_snapshot");
    return Number(value);
  };
  return { code: readString(order, "public_code"), name: readString(order, "customer_name_snapshot"), email,
    subtotal: amount(order, "subtotal"), discount: amount(order, "discount_total"), shipping: amount(order, "shipping_total"),
    fees: amount(order, "fee_total"), total: amount(order, "grand_total"),
    address: [readString(address, "street"), readString(address, "number"), readString(address, "district"),
      readString(address, "city"), readString(address, "state")].filter(Boolean).join(", "),
    items: source.items.map((item: unknown) => {
      if (!isUnknownRecord(item)) throw new EmailError("invalid_order_snapshot");
      return { name: readString(item, "product_name_snapshot"), color: readString(item, "color_snapshot"), size: readString(item, "size_snapshot"),
        quantity: amount(item, "quantity"), unitPrice: amount(item, "unit_price"), total: amount(item, "total") };
    }) };
}

// The scheduled handler supplies bindings directly. No build-time environment fallback.
export async function runTransactionalEmailJobs(environment: Environment, executionId: string, limit = 4, transport: typeof fetch = fetch) {
  const readiness = getResendReadiness(environment);
  // The explicit, disabled-commercial test is independent of database health.
  if (!readiness.configured) await runEmailHomologation(environment, executionId, transport);
  const db = database(environment, transport);
  if (!db) return { ok: false, processed: 0, failed: 0 };
  await call(db, "sync_transactional_email_runtime", { p_enabled: readiness.enabled, p_configured: readiness.configured });
  if (!readiness.configured) {
    return { ok: true, processed: 0, failed: 0 };
  }
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < Math.min(Math.max(limit, 1), 8); index += 1) {
    const lockId = crypto.randomUUID();
    const job = await call(db, "claim_transactional_email", { p_lock_id: lockId });
    if (!isUnknownRecord(job)) break;
    if (job.skipped === true) continue;
    const jobId = readString(job, "id");
    const messageId = readString(job, "messageId");
    const providerId = readString(job, "providerId");
    const kind = readString(job, "kind");
    const finish = (args: Record<string, unknown>) => call(db, "finish_transactional_email", { p_job_id: jobId, p_lock_id: lockId, ...args });
    try {
      if (providerId) {
        const event = await getTransactionalEmailStatus(environment.RESEND_API_KEY ?? "", providerId, transport);
        if (await finish({ p_outcome: "observed", p_last_event: event,
          p_error_code: ["bounced", "complained", "failed", "suppressed"].includes(event) ? "email_delivery_failed" : null }) !== true)
          throw new EmailError("email_lease_lost");
      } else {
        if (kind !== "purchase_confirmed" && kind !== "review_requested") throw new EmailError("invalid_email_kind");
        const source = await call(db, "read_transactional_email_source", { p_job_id: jobId, p_lock_id: lockId });
        if (!source) { await finish({ p_outcome: "cancelled", p_error_code: "email_no_longer_eligible" }); continue; }
        const payload = isUnknownRecord(job.payload) ? job.payload : renderTransactionalEmail({ kind,
          order: emailOrderFromSource(source), from: readiness.from, replyTo: readiness.replyTo,
          storeUrl: environment.NEXT_PUBLIC_STORE_URL ?? "", messageId });
        const attempt = await call(db, "begin_transactional_email", { p_job_id: jobId, p_lock_id: lockId, p_payload: payload });
        if (!isUnknownRecord(attempt) || !isUnknownRecord(attempt.payload) || !readString(attempt, "idempotencyKey")) {
          await finish({ p_outcome: "cancelled", p_error_code: "email_no_longer_eligible" }); continue;
        }
        const acceptedId = await sendTransactionalEmail(environment.RESEND_API_KEY ?? "", attempt.payload as EmailPayload,
          readString(attempt, "idempotencyKey"), transport);
        // Failure to persist the receipt is uncertain even after a successful provider response.
        try {
          if (await finish({ p_outcome: "accepted", p_provider_id: acceptedId }) !== true) throw new EmailError("email_lease_lost");
        } catch { throw new EmailError("email_acceptance_uncertain", true, true); }
      }
      processed += 1;
    } catch (error) {
      failed += 1;
      const issue = error instanceof EmailError ? error : new EmailError("email_processing_failed", true);
      if (issue.code === "email_lease_lost") break;
      await finish({ p_outcome: issue.uncertain ? "uncertain" : issue.retryable ? "retry" : "failed",
        p_error_code: issue.code, p_retry_after_seconds: issue.retryAfterSeconds });
      logServerEvent("error", "transactional_email_job_failed", { executionId, jobId, messageId, code: issue.code });
    }
  }
  await call(db, "sync_transactional_email_runtime", { p_enabled: readiness.enabled, p_configured: readiness.configured });
  return { ok: failed === 0, processed, failed };
}
