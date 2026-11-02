import "server-only";
import { BlingError, type BlingClient } from "@curtiz/integrations";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUnknownRecord, readString } from "./unknown-data";

const row = (value: unknown) => isUnknownRecord(value) ? value : {};
const positive = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

// A webhook describes every note in the connected account, including manual
// notes and documents belonging to other channels. Never infer a local order.
export async function observeBlingInvoice(db: SupabaseClient, provider: BlingClient, invoiceId: number,
  options: { ignoreUnrelated?: boolean } = {}): Promise<boolean> {
  if (!positive(invoiceId)) throw new BlingError("invalid_invoice_response", 502);
  const observedAt = new Date().toISOString();
  const invoice = row(row(await provider.request(`/nfe/${invoiceId}`)).data);
  if (!positive(invoice.id) || Number(invoice.id) !== invoiceId || !Number.isInteger(Number(invoice.situacao))
    || Number(invoice.situacao) < 1 || Number(invoice.situacao) > 11)
    throw new BlingError("invalid_invoice_response", 502);
  const storeCode = readString(invoice, "numeroPedidoLoja");
  const result = await db.rpc("read_bling_invoice_order", { p_invoice_id: invoiceId, p_order_code: storeCode });
  if (result.error) {
    if (result.error.code === "23514") throw new BlingError("invoice_link_conflict", 409);
    throw new BlingError("storage_unavailable", 503, true);
  }
  if (result.data === null) {
    if (options.ignoreUnrelated) return false;
    throw new BlingError("invoice_order_unlinked", 409);
  }
  const link = row(result.data), code = readString(link, "orderCode");
  if (!code || !positive(link.externalOrderId) || storeCode && storeCode !== code
    || link.invoiceId != null && Number(link.invoiceId) !== invoiceId)
    throw new BlingError("invoice_link_conflict", 409);
  if (link.invoiceId == null) {
    // Store reference alone is not proof: confirm the canonical provider sale.
    const sale = row(row(await provider.request(`/pedidos/vendas/${Number(link.externalOrderId)}`)).data);
    if (Number(sale.id) !== Number(link.externalOrderId) || readString(sale, "numeroLoja") !== code
      || Number(row(sale.notaFiscal).id) !== invoiceId) throw new BlingError("invoice_link_conflict", 409);
  }
  const saved = await db.rpc("observe_bling_invoice", { p_invoice_id: invoiceId, p_order_code: code,
    p_situation: Number(invoice.situacao), p_invoice_number: readString(invoice, "numero"),
    p_access_key: readString(invoice, "chaveAcesso"), p_observed_at: observedAt });
  if (saved.error) throw new BlingError("storage_unavailable", 503, true);
  if (saved.data !== true) throw new BlingError("invoice_link_conflict", 409);
  return true;
}
