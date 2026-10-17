import "server-only";
import { BlingError, blingFiscalMirrorHash, buildBlingOrderFiscalMirror, selectBlingFiscalRule } from "@curtiz/integrations";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUnknownRecord, readString } from "./unknown-data";

export async function ensureBlingFiscalApproval(db: SupabaseClient, order: Record<string, unknown>, items: Record<string, unknown>[]) {
  const existing = await db.rpc("read_bling_fiscal_mirror_approval", { p_order_id: order.id });
  if (existing.error) throw new BlingError("storage_unavailable", 503, true);
  const approved = isUnknownRecord(existing.data) ? existing.data : null;
  const context = approved ? { data: null, error: null } : await db.rpc("read_bling_fiscal_automation_context", { p_order_id: order.id });
  if (context.error) throw new BlingError("storage_unavailable", 503, true);
  const value = isUnknownRecord(context.data) ? context.data : {};
  const recipient = approved ?? (isUnknownRecord(value.recipient) ? value.recipient : {});
  if (!approved && (value.policyApproved !== true || typeof value.configurationHash !== "string")) throw new BlingError("fiscal_automation_policy_required", 409);
  if (typeof recipient.icms_taxpayer !== "boolean" || typeof recipient.final_consumer !== "boolean") throw new BlingError("fiscal_recipient_required", 409);
  const rules = await db.rpc("read_bling_fiscal_rules");
  if (rules.error) throw new BlingError("storage_unavailable", 503, true);
  const snapshots: Record<string, unknown>[] = [];
  for (const item of items) {
    const result = await db.rpc("read_bling_catalog_variant", { p_variant_id: item.variant_id });
    if (result.error || !isUnknownRecord(result.data)) throw new BlingError("product_fiscal_data_required", 409);
    snapshots.push(result.data);
  }
  const mirror = await buildBlingOrderFiscalMirror({ rules: rules.data, order, items, snapshots,
    icmsTaxpayer: recipient.icms_taxpayer, finalConsumer: recipient.final_consumer });
  if (!mirror.rule.external_nature_id) throw new BlingError("nature_required", 409);
  if (mirror.blockers.includes("kit_fiscal_unit_confirmation_required")) throw new BlingError("kit_fiscal_unit_confirmation_required", 409);
  if (mirror.blockers.includes("kit_fiscal_composition_required")) throw new BlingError("kit_fiscal_composition_required", 409);
  if (mirror.blockers.includes("fiscal_tax_codes_required")) throw new BlingError("fiscal_tax_codes_required", 409);
  const hash = await blingFiscalMirrorHash(mirror);
  if (approved) {
    if (approved.mirror_hash !== hash) throw new BlingError("fiscal_mirror_changed", 409);
    return approved;
  }
  const saved = await db.rpc("save_bling_automatic_mirror_approval", { p_order_id: order.id, p_mirror_hash: hash,
    p_configuration_hash: value.configurationHash, p_icms_taxpayer: recipient.icms_taxpayer, p_final_consumer: recipient.final_consumer });
  if (saved.error) throw new BlingError("storage_unavailable", 503, true);
  if (saved.data !== true) throw new BlingError("fiscal_mirror_changed", 409);
  return { mirror_hash: hash, icms_taxpayer: recipient.icms_taxpayer, final_consumer: recipient.final_consumer };
}

export async function resolveBlingOrderNature(db: SupabaseClient, order: Record<string, unknown>, items: Record<string, unknown>[]) {
  const approval = await ensureBlingFiscalApproval(db, order, items);
  const rules = await db.rpc("read_bling_fiscal_rules");
  if (rules.error) throw new BlingError("storage_unavailable", 503, true);
  const address = isUnknownRecord(order.shipping_address_snapshot) ? order.shipping_address_snapshot : {};
  if (typeof approval.icms_taxpayer !== "boolean" || typeof approval.final_consumer !== "boolean") throw new BlingError("fiscal_recipient_required", 409);
  const rule = selectBlingFiscalRule(rules.data, { destinationState: readString(address, "state"), operation: "sale",
    icmsTaxpayer: approval.icms_taxpayer, finalConsumer: approval.final_consumer });
  if (!rule.external_nature_id) throw new BlingError("nature_required", 409);
  return rule.external_nature_id;
}

const hashDocument = async (value: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))]
  .map(b => b.toString(16).padStart(2, "0")).join("");

export async function archiveBlingInvoice(db: SupabaseClient, provider: {
  invoiceDocument: (key: string, format?: "pdf" | "xml") => Promise<ArrayBuffer>;
}, orderId: string, invoiceId: number, key: string) {
  const bucket = await db.storage.getBucket("fiscal-documents");
  if (bucket.error || bucket.data?.public !== false) throw new BlingError("fiscal_archive_unavailable", 503, true);
  const existing = await db.rpc("read_bling_invoice_archives", { p_order_id: orderId });
  if (existing.error || !Array.isArray(existing.data)) throw new BlingError("storage_unavailable", 503, true);
  for (const format of ["xml", "pdf"] as const) {
    if (existing.data.some((row: unknown) => isUnknownRecord(row) && Number(row.invoice_id) === invoiceId && row.format === format)) continue;
    const document = await provider.invoiceDocument(key, format), hash = await hashDocument(document);
    const path = `${orderId}/${invoiceId}/${hash}.${format}`;
    const stored = await db.storage.from("fiscal-documents").upload(path, document,
      { contentType: format === "pdf" ? "application/pdf" : "application/xml", upsert: false });
    if (stored.error) {
      // Recover an upload whose database acknowledgement was lost; never overwrite a document.
      const prior = await db.storage.from("fiscal-documents").download(path);
      if (prior.error || !prior.data || prior.data.size > 10_000_000) throw new BlingError("fiscal_archive_unavailable", 503, true);
      if (await hashDocument(await prior.data.arrayBuffer()) !== hash) throw new BlingError("fiscal_archive_mismatch", 409);
    }
    const saved = await db.rpc("save_bling_invoice_archive", { p_order_id: orderId, p_invoice_id: invoiceId,
      p_format: format, p_path: path, p_sha256: hash });
    if (saved.error || saved.data !== true) throw new BlingError("fiscal_archive_unavailable", 503, true);
  }
}
