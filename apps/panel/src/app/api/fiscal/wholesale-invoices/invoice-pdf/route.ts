import { type NextRequest, NextResponse } from "next/server";
import { authorizedInvoicePdfResponse } from "@/lib/bling-invoice-pdf";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { technicalNoStore } from "@/lib/technical-api";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const send = (message: string, status: number) => NextResponse.json({ message }, { status, headers: technicalNoStore });
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

// Mesma permissão da emissão: sessão com MFA e a função list_wholesale_kit_invoices.
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!uuid.test(id)) return send("Nota inválida.", 400);
  const db = await createServerSupabaseClient();
  const auth = db ? await db.auth.getUser() : null;
  if (!db || !auth || auth.error || !auth.data.user || !await hasRequiredInternalMfa(db)) return send("Acesso negado.", 403);
  const list = await db.rpc("list_wholesale_kit_invoices", { p_limit: 100 });
  if (list.error) return send("As notas de atacado estão indisponíveis.", list.error.code === "42501" ? 403 : 503);
  const row = (Array.isArray(list.data) ? list.data : []).map(record).find(item => item?.id === id);
  const invoiceId = Number(row?.invoiceId);
  const key = typeof row?.invoiceKey === "string" ? row.invoiceKey : "";
  if (!row || row.authorized !== true || !Number.isSafeInteger(invoiceId) || invoiceId <= 0 || !/^\d{44}$/u.test(key))
    return send("PDF indisponível no Bling.", 404);
  return authorizedInvoicePdfResponse({ invoiceId, expectedKey: key,
    invoiceNumber: typeof row.invoiceNumber === "string" ? row.invoiceNumber : undefined,
    download: request.nextUrl.searchParams.get("download") === "1" });
}
