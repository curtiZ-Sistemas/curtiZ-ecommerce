import { type NextRequest, NextResponse } from "next/server";
import { authorizedInvoicePdfResponse } from "@/lib/bling-invoice-pdf";
import { authorizeBlingPanelRequest } from "@/lib/bling-server";
import { technicalNoStore } from "@/lib/technical-api";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const send = (message: string, status: number) => NextResponse.json({ message }, { status, headers: technicalNoStore });
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

// Mesma permissão da lista "Pedidos no Bling" (função list_bling_order_issues, que valida a permissão no banco).
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId") ?? "";
  if (!uuid.test(orderId)) return send("Pedido inválido.", 400);
  const db = await authorizeBlingPanelRequest(request);
  if (!db) return send("Acesso negado.", 403);
  const list = await db.rpc("list_bling_order_issues", { p_filter: "all", p_limit: 100 });
  if (list.error) return send("Pedidos indisponíveis.", list.error.code === "42501" ? 403 : 503);
  const row = (Array.isArray(list.data) ? list.data : []).map(record).find(item => item?.orderId === orderId);
  const invoiceId = Number(row?.invoiceId);
  if (!row || row.invoiceStatus !== "authorized" || !Number.isSafeInteger(invoiceId) || invoiceId <= 0)
    return send("PDF indisponível no Bling.", 404);
  return authorizedInvoicePdfResponse({ invoiceId, download: request.nextUrl.searchParams.get("download") === "1" });
}
