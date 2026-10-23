import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getMercadoPagoCredentials } from "@curtiz/config";
import { MercadoPagoPaymentProvider } from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";
import { assertKitPayment, kitCall, kitRecord, reconcileKitTestPayment } from "./representative-test-transactions";
import { isUnknownRecord, readRows, readString } from "./unknown-data";

export async function runRepresentativeTestJobs(environment: Readonly<Record<string, string | undefined>>, transport: typeof fetch = fetch) {
  const credentials = getMercadoPagoCredentials(environment);
  if (credentials?.mode !== "test") return;
  const key = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!key || !environment.SUPABASE_URL) return;
  const url = new URL(environment.SUPABASE_URL);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return;
  const db = createClient(url.origin, key, { global: { fetch: transport }, auth: { autoRefreshToken: false, persistSession: false } });
  const jobs = await kitCall(db, "due_kit_test_transactions", {});
  if (!Array.isArray(jobs) || jobs.some(job => !isUnknownRecord(job))) throw new Error("kit_job_invalid");
  const provider = new MercadoPagoPaymentProvider(credentials.accessToken, "test", transport);
  let processed = 0;
  let failed = 0;
  for (const job of readRows(jobs)) {
    const orderId = readString(job, "orderId");
    try {
      const providerId = readString(job, "providerPaymentId");
      if (!providerId) {
        if (await kitCall(db, "cancel_unstarted_kit_test_transaction", { p_actor: readString(job, "actorId"), p_order: orderId }) !== true)
          throw new Error("kit_expiration_requires_reconciliation");
        processed += 1;
        continue;
      }
      let payment = await provider.getPayment(providerId);
      const context = await kitRecord(db, "read_kit_test_transaction", { p_actor: readString(job, "actorId"), p_order: orderId });
      assertKitPayment(context, payment);
      // Only the server's due-date query selects expired intents. Approval wins a cancellation race.
      if (context.state === "reserved" && ["pending", "in_process"].includes(payment.status)
        && payment.expiresAt && Number.isFinite(Date.parse(payment.expiresAt)) && Date.parse(payment.expiresAt) <= Date.now()) {
        payment = await provider.cancelPayment(providerId);
      }
      await reconcileKitTestPayment(db, payment);
      processed += 1;
    } catch {
      failed += 1;
      logServerEvent("error", "representative_test_reconciliation_failed", { orderId, code: "kit_reconciliation_failed" });
    }
  }
  return { processed, failed };
}
