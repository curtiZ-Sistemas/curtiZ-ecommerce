import "server-only";
import { BlingError, readBlingAuthorizedResaleReturnXml, type BlingClient } from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kitCall } from "./representative-test-transactions";
import { isUnknownRecord, readNumber, readRows, readString, type UnknownRecord } from "./unknown-data";

const row = (value: unknown) => isUnknownRecord(value) ? value : {};
const invalid = () => new BlingError("kit_return_invoice_invalid", 409);
const digest = async (data: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data)),
  byte => byte.toString(16).padStart(2,"0")).join("");

export async function verifyRepresentativeKitReturnInvoice(provider: BlingClient, job: UnknownRecord) {
  const id = readNumber(job,"invoiceId");
  const originalInvoiceId = readNumber(job,"originalInvoiceId");
  const key = readString(job,"invoiceKey");
  const originalKey = readString(job,"originalKey");
  const origin = readString(job,"documentOrigin");
  const rule = row(job.returnRule);
  const taxCodeKind = readString(rule,"taxCodeKind");
  const series = readNumber(rule,"series");
  const natureId = readNumber(rule,"external_nature_id");
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(originalInvoiceId) || originalInvoiceId <= 0 || id === originalInvoiceId
    || !/^31\d{42}$/u.test(key) || !/^31\d{42}$/u.test(originalKey)
    || (origin !== "buyer_outflow" && origin !== "own_inflow") || (taxCodeKind !== "CST" && taxCodeKind !== "CSOSN")
    || !Number.isSafeInteger(series) || series < 1 || !Number.isSafeInteger(natureId) || natureId <= 0) throw invalid();
  const invoice = row(row(await provider.request(`/nfe/${id}`)).data);
  if (Number(invoice.id) !== id || invoice.chaveAcesso !== key || Number(invoice.situacao) !== 5
    || Number(invoice.serie) !== series || Number(row(invoice.naturezaOperacao).id) !== natureId) throw invalid();
  const source = row(row(await provider.request(`/nfe/${originalInvoiceId}`)).data);
  if (Number(source.id) !== originalInvoiceId || source.chaveAcesso !== originalKey || Number(source.situacao) !== 5) throw invalid();
  const original = await provider.invoiceDocument(originalKey,"xml");
  if (await digest(original) !== job.originalHash) throw invalid();
  const returned = await provider.invoiceDocument(key,"xml");
  const decode = new TextDecoder("utf-8",{ fatal: true });
  const selection = job.requestedPairs == null
    ? { returnKitQuantity: readNumber(job,"returnQuantity") }
    : { returnedPairs: Object.entries(row(job.requestedPairs)).map(([sku, quantity]) => {
      if (typeof quantity !== "number") throw invalid();
      return { sku, quantity };
    }) };
  const verified = readBlingAuthorizedResaleReturnXml(decode.decode(returned),key,decode.decode(original),{
    origin, environment: 1, issuerDocument: readString(job,"issuerDocument"), buyerDocument: readString(job,"buyerDocument"),
    originalKey, originalKitQuantity: readNumber(job,"originalQuantity"), ...selection,
    cfop: readString(rule,"cfop"), taxCodeKind, taxCode: readString(rule,"taxCode"),
    refundInCents: readNumber(job,"fiscalTotalInCents",readNumber(job,"refundInCents"))
  });
  return { ...verified, hash: await digest(returned) };
}

export async function verifyDueRepresentativeKitReturns(db: SupabaseClient, provider: BlingClient) {
  const pending = await kitCall(db,"due_representative_kit_return_invoices",{});
  if (!Array.isArray(pending)) throw invalid();
  for (const job of readRows(pending)) {
    const returnId = readString(job,"returnId");
    try {
      const proof = await verifyRepresentativeKitReturnInvoice(provider,job);
      if (await kitCall(db,"record_representative_kit_return_invoice_lines",{
        p_return: returnId, p_key: proof.key, p_protocol: proof.protocol, p_hash: proof.hash, p_lines: proof.fiscalLines
      }) !== true) throw invalid();
    } catch {
      logServerEvent("error","representative_kit_return_verification_failed",{ returnId });
      await kitCall(db,"defer_representative_kit_return_invoice",{ p_return: returnId });
    }
  }
}
