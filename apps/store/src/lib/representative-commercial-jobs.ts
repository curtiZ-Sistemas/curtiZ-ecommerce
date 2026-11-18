import "server-only";
import { createClient } from "@supabase/supabase-js";
import { logServerEvent } from "@curtiz/security";
import {
  commercialKitCollector, commercialKitPaymentProvider, reconcileCommercialKitRefund, recoverCommercialKitPayment
} from "./representative-commercial-payments";
import { kitCall } from "./representative-test-transactions";
import { type RuntimeEnvironment } from "./runtime-environment";
import { readRows, readString } from "./unknown-data";

export async function runRepresentativeCommercialJobs(environment: RuntimeEnvironment, transport: typeof fetch = fetch) {
  // Recovery remains available when new purchases are disabled.
  if (environment.APP_ENV !== "production" || !environment.REPRESENTATIVE_KIT_MP_COLLECTOR_ID) return;
  const key = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!key || !environment.SUPABASE_URL) return;
  const url = new URL(environment.SUPABASE_URL);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return;
  const db = createClient(url.origin, key, { global: { fetch: transport }, auth: { autoRefreshToken: false, persistSession: false } });
  const jobs = await kitCall(db, "due_representative_kit_payments", {});
  if (!Array.isArray(jobs)) throw new Error("kit_job_invalid");
  for (const job of readRows(jobs)) {
    const orderId = readString(job, "orderId");
    try {
      if (!readString(job, "startedAt")) {
        await kitCall(db, "cancel_unstarted_representative_kit_order", { p_actor: null, p_order: orderId });
      } else {
        await recoverCommercialKitPayment(db, commercialKitPaymentProvider(environment, transport),
          commercialKitCollector(environment), job);
      }
    } catch {
      logServerEvent("error", "representative_commercial_reconciliation_failed", { orderId });
      await kitCall(db, "defer_representative_kit_payment_check", { p_order: orderId }).catch(() => null);
    }
  }
  const refunds = await kitCall(db, "due_representative_kit_refunds", {});
  if (!Array.isArray(refunds)) throw new Error("kit_refund_job_invalid");
  for (const job of readRows(refunds)) {
    const refundId = readString(job, "refundId");
    try {
      await reconcileCommercialKitRefund(db, commercialKitPaymentProvider(environment, transport),
        commercialKitCollector(environment), job, environment.REPRESENTATIVE_KIT_REFUNDS_ENABLED === "true");
    } catch {
      logServerEvent("error", "representative_commercial_refund_reconciliation_failed", { refundId });
    } finally {
      await kitCall(db, "defer_representative_kit_refund", { p_refund: refundId });
    }
  }
}
