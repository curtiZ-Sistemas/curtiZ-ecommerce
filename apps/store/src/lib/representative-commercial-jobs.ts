import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getMercadoPagoCredentials, representativePointIntent, representativePointRefund } from "@curtiz/config";
import { reconcileRepresentativePoint, reconcileRepresentativePointRefund } from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";
import {
  commercialKitCollector, commercialKitPaymentProvider, reconcileCommercialKitRefund, recoverCommercialKitPayment
} from "./representative-commercial-payments";
import { kitCall } from "./representative-test-transactions";
import { type RuntimeEnvironment } from "./runtime-environment";
import { readRows, readString } from "./unknown-data";

async function reconcileCollection(db: SupabaseClient, environment: RuntimeEnvironment, transport: typeof fetch) {
  const credentials = getMercadoPagoCredentials(environment);
  if (credentials?.mode !== "production") return;
  const configuration = { accessToken: credentials.accessToken, collector: commercialKitCollector(environment) };
  const payments = await kitCall(db, "due_representative_kit_collection_payments", {});
  for (const job of readRows(payments)) {
    const orderId = readString(job, "orderId");
    const intent = representativePointIntent.safeParse(job);
    if (!intent.success || !intent.data.pointOrderId) continue;
    try {
      const payment = await reconcileRepresentativePoint(transport, configuration, intent.data, "refresh");
      if (await kitCall(db, "record_representative_kit_point", {
        p_order: orderId, p_key: intent.data.pointKey, p_point_order: payment.id,
        p_status: payment.status, p_receipt: payment.receipt
      }) !== true) throw new Error("point_receipt_not_recorded");
    } catch {
      logServerEvent("error", "representative_collection_payment_reconciliation_failed", { orderId });
    } finally {
      await kitCall(db, "defer_representative_kit_collection_payment", { p_order: orderId, p_point_key: intent.data.pointKey });
    }
  }

  const refunds = await kitCall(db, "due_representative_kit_collection_refunds", {});
  for (const job of readRows(refunds)) {
    const intent = representativePointRefund.safeParse(job);
    if (!intent.success) continue;
    const refundId = intent.data.refundId;
    try {
      const reference = await reconcileRepresentativePointRefund(transport, configuration, { ...intent.data, maySend: false });
      if (reference && await kitCall(db, "record_representative_kit_collection_refund", {
        p_refund: refundId, p_provider_refund: reference
      }) !== true) throw new Error("point_refund_not_recorded");
    } catch {
      logServerEvent("error", "representative_collection_refund_reconciliation_failed", { refundId });
    } finally {
      await kitCall(db, "defer_representative_kit_refund", { p_refund: refundId });
    }
  }
}

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
  await reconcileCollection(db, environment, transport);
}
