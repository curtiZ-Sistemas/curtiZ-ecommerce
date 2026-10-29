import "server-only";
import { BlingError, BLING_RETURN_XML_LIMIT, buildBlingArchivedReturnMirror, readBlingReturnOriginalXml } from "@curtiz/integrations";
import { z } from "zod";
import type { createServiceSupabaseClient } from "./supabase/server";

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const contextSchema = z.object({ returnId: z.uuid(), orderId: z.uuid(), invoiceId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  invoiceKey: z.string().regex(/^\d{44}$/u), archive: z.object({ storagePath: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }),
  totals: z.object({ totalInCents: cents, shippingInCents: cents, discountInCents: cents, additionalInCents: cents }),
  items: z.array(z.object({ id: z.uuid(), variantId: z.uuid(), sku: z.string().min(1), quantity: z.number().int().positive(),
    unitPriceInCents: cents, requestedQuantity: cents, otherReturnsQuantity: cents })).min(1).max(990) });

export async function buildArchivedBlingReturnPreview(db: NonNullable<ReturnType<typeof createServiceSupabaseClient>>, returnId: string) {
  const [result, rules] = await Promise.all([db.rpc("read_bling_return_fiscal_context", { p_return_id: returnId }), db.rpc("read_bling_fiscal_rules")]);
  if (result.error || rules.error) throw new BlingError("return_context_unavailable", 503);
  const parsed = contextSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.returnId !== returnId) throw new BlingError("return_original_invoice_context_required", 409);
  const context = parsed.data;
  const expectedPath = `${context.orderId}/${context.invoiceId}/${context.archive.sha256}.xml`;
  if (context.archive.storagePath !== expectedPath) throw new BlingError("original_invoice_archive_mismatch", 409);
  const file = await db.storage.from("fiscal-documents").download(expectedPath);
  if (file.error || !file.data) throw new BlingError("original_invoice_archive_unavailable", 503);
  if (file.data.size > BLING_RETURN_XML_LIMIT) throw new BlingError("original_invoice_xml_invalid", 409);
  const bytes = await file.data.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== context.archive.sha256) throw new BlingError("original_invoice_archive_mismatch", 409);
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new BlingError("original_invoice_xml_invalid", 409); }
  const original = readBlingReturnOriginalXml(xml, context.invoiceKey);
  const mirror = buildBlingArchivedReturnMirror(rules.data, original, context.items, context.totals);
  return { ...mirror, returnId, orderId: context.orderId, sourceDocumentSha256: hash };
}
