import "server-only";
import { BlingError } from "@curtiz/integrations";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUnknownRecord } from "./unknown-data";

// Classification is explicit: a document type or representative role is not tax evidence.
export function assertBlingB2CRecipient(recipient: Record<string, unknown>) {
  if (typeof recipient.icms_taxpayer !== "boolean" || typeof recipient.final_consumer !== "boolean")
    throw new BlingError("fiscal_recipient_required", 409);
  if (recipient.icms_taxpayer || !recipient.final_consumer)
    throw new BlingError("fiscal_scenario_not_homologated", 409);
}

export async function readBlingFiscalRecipient(db: SupabaseClient, orderId: unknown) {
  const result = await db.rpc("read_bling_fiscal_automation_context", { p_order_id: orderId });
  if (result.error) throw new BlingError("storage_unavailable", 503, true);
  const context = isUnknownRecord(result.data) ? result.data : {};
  return isUnknownRecord(context.recipient) ? context.recipient : {};
}
