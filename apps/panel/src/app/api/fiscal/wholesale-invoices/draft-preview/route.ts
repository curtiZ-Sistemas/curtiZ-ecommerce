import { type NextRequest, NextResponse } from "next/server";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { blingConfigured, panelBlingClient } from "@/lib/bling-server";
import { technicalNoStore } from "@/lib/technical-api";
import { inspectWholesaleDraft } from "@/lib/wholesale-kit-invoice";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const send = (value: object, status = 200) => NextResponse.json(value, { status, headers: technicalNoStore });
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!uuid.test(id)) return send({ message: "Nota inválida." }, 400);
  const db = await createServerSupabaseClient();
  const auth = db ? await db.auth.getUser() : null;
  if (!db || !auth || auth.error || !auth.data.user || !await hasRequiredInternalMfa(db)) return send({ message: "Acesso negado." }, 403);
  // Reuse the permission-protected list: never accept a provider ID from the client.
  const list = await db.rpc("list_wholesale_kit_invoices", { p_limit: 100 });
  if (list.error) return send({ message: "Consulta indisponível." }, list.error.code === "42501" ? 403 : 503);
  const note = Array.isArray(list.data) ? list.data.map(record).find(item => item?.id === id) : null;
  const invoiceId = Number(note?.invoiceId);
  if (!note || note.authorized === true || note.externalReported === true || (note.status === "cancelled" && note.cancelPending !== true)
    || !Number.isSafeInteger(invoiceId) || invoiceId <= 0) return send({ message: "Rascunho indisponível." }, 404);
  if (!blingConfigured() || process.env.APP_ENV !== "production") return send({ message: "Integração indisponível." }, 503);
  const service = createServiceSupabaseClient();
  if (!service) return send({ message: "Consulta indisponível." }, 503);
  try {
    const review = await inspectWholesaleDraft({ db: service, provider: panelBlingClient(service), invoiceId: id, expectedDraftId: invoiceId });
    return send({ review });
  } catch {
    return send({ message: "Não foi possível confirmar este documento no Bling. Nenhuma alteração foi realizada." }, 409);
  }
}
