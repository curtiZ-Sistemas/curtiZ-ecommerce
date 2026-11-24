import "server-only";

import { BlingError } from "@curtiz/integrations";
import { NextResponse } from "next/server";
import { panelBlingClient } from "./bling-server";
import { createServiceSupabaseClient } from "./supabase/server";
import { technicalNoStore } from "./technical-api";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const reply = (message: string, status: number) => NextResponse.json({ message }, { status, headers: technicalNoStore });

export const invoicePdfHeaders = {
  ...technicalNoStore,
  "x-content-type-options": "nosniff"
};

/**
 * Baixa a DANFE de uma NF-e já autorizada no Bling, sem expor tokens ao navegador.
 * Confere a situação e a chave de acesso no próprio Bling antes de devolver o PDF.
 */
export async function authorizedInvoicePdfResponse(input: {
  invoiceId: number; expectedKey?: string; invoiceNumber?: string; download: boolean;
}): Promise<NextResponse> {
  if (!Number.isSafeInteger(input.invoiceId) || input.invoiceId <= 0) return reply("PDF indisponível no Bling.", 404);
  const service = createServiceSupabaseClient();
  if (!service) return reply("Documento indisponível. Tente novamente.", 503);
  try {
    const provider = panelBlingClient(service);
    const result = record(await provider.request(`/nfe/${input.invoiceId}`));
    const invoice = record(result?.data);
    const key = typeof invoice?.chaveAcesso === "string" ? invoice.chaveAcesso : "";
    // Bling: situação 5 = autorizada, 6 = emitida DANFE.
    if (!invoice || ![5, 6].includes(Number(invoice.situacao)) || !/^\d{44}$/u.test(key)
      || (input.expectedKey && input.expectedKey !== key)) return reply("PDF indisponível no Bling.", 404);
    const pdf = await provider.invoiceDocument(key, "pdf");
    const number = /^\d{1,9}$/u.test(input.invoiceNumber ?? "") ? input.invoiceNumber : String(input.invoiceId);
    return new NextResponse(pdf, { headers: { ...invoicePdfHeaders, "content-type": "application/pdf",
      "content-disposition": `${input.download ? "attachment" : "inline"}; filename="danfe-${number}.pdf"` } });
  } catch (error) {
    if (error instanceof BlingError && (error.status === 404 || error.code === "invalid_document"))
      return reply("PDF indisponível no Bling.", 404);
    return reply("Não foi possível obter o PDF agora. Tente novamente.", 503);
  }
}
