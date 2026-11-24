import { type NextRequest, NextResponse } from "next/server";
import { authorizedInvoicePdfResponse } from "@/lib/bling-invoice-pdf";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { technicalNoStore } from "@/lib/technical-api";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const send = (message: string, status: number) => NextResponse.json({ message }, { status, headers: technicalNoStore });
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

// Mesma permissão da fila fiscal dos kits: sessão com MFA e a função list_representative_kit_fiscal_work.
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId") ?? "";
  if (!uuid.test(orderId)) return send("Pedido inválido.", 400);
  const db = await createServerSupabaseClient();
  const auth = db ? await db.auth.getUser() : null;
  if (!db || !auth || auth.error || !auth.data.user || !await hasRequiredInternalMfa(db)) return send("Acesso negado.", 403);
  const queue = await db.rpc("list_representative_kit_fiscal_work");
  if (queue.error) return send("A fila fiscal está indisponível.", queue.error.code === "42501" ? 403 : 503);
  const row = (Array.isArray(queue.data) ? queue.data : []).map(record).find(item => item?.orderId === orderId);
  const invoiceId = Number(row?.invoiceId);
  const key = typeof row?.invoiceKey === "string" ? row.invoiceKey : "";
  if (!row || row.invoiceAuthorized !== true || !Number.isSafeInteger(invoiceId) || invoiceId <= 0 || !/^\d{44}$/u.test(key))
    return send("PDF indisponível no Bling.", 404);
  return authorizedInvoicePdfResponse({ invoiceId, expectedKey: key,
    invoiceNumber: typeof row.invoiceNumber === "string" ? row.invoiceNumber : undefined,
    download: request.nextUrl.searchParams.get("download") === "1" });
}
