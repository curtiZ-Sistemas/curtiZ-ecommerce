import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cancelCustomerOrder } from "./customer-order-cancellation";
import { isUnknownRecord, readString } from "./unknown-data";
import { logServerEvent } from "@curtiz/security";

export async function runAfterSaleJobs(environment: Readonly<Record<string, string | undefined>>, executionId: string,
  transport: typeof fetch = fetch) {
  const secret = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  let url: URL;
  try { url = new URL(environment.SUPABASE_URL ?? ""); } catch { return { processed: 0 }; }
  if (!secret || url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return { processed: 0 };
  const db = createClient(url.origin, secret, { global: { fetch: transport }, auth: { autoRefreshToken: false, persistSession: false } });
  let processed = 0;
  for (let index = 0; index < 2; index += 1) {
    const lockId = crypto.randomUUID();
    const claim = await db.rpc("claim_after_sale_job", { p_lock_id: lockId });
    if (claim.error) throw new Error("after_sale_storage_unavailable");
    if (!isUnknownRecord(claim.data)) break;
    const job = claim.data;
    let completed = false;
    try {
      const result = await cancelCustomerOrder(readString(job, "orderId"), readString(job, "customerId"), { db, environment, transport });
      completed = result.statusCode === 200 && "status" in result.body && ["cancelled", "refunded"].includes(String(result.body.status));
    } finally {
      const finish = await db.rpc("finish_after_sale_job", { p_job_id: readString(job, "id"), p_lock_id: lockId, p_completed: completed });
      if (finish.error || finish.data !== true) throw new Error("after_sale_lease_lost");
    }
    processed += 1;
  }
  logServerEvent("info", "after_sale_jobs_completed", { executionId, processed });
  return { processed };
}
