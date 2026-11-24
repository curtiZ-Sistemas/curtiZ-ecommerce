// A lógica fiscal vive em @curtiz/integrations para o painel e a loja usarem a mesma.
export {
  assertBlingInvoicePaymentTerms, blingFiscalDraftBody, blingInvoicePaymentTerms, invoiceMatchesFiscalLines,
  prepareBlingFiscalDraft, requestBlingFiscalResource, type BlingInvoicePaymentTerm
} from "@curtiz/integrations";
