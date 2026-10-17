import { isAllowedBrowserRequest, readJsonResponse } from "@curtiz/security";
import { MelhorEnvioError } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumePanelMutationBudget, panelRateLimitStatus } from "@/lib/api-rate-limit";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import { panelMelhorEnvioProvider } from "@/lib/melhor-envio-server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.flatMap(item => row(item) ? [item as Row] : []) : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const noStore = { "cache-control": "private, no-store" };
const schema = z.object({ action: z.enum(["create", "purchase", "generate", "preview", "print", "sync", "cancel"]),
  shipmentId: z.string().uuid(), reason: z.string().trim().min(3).max(500).optional() });
const safeOrigin = (request: NextRequest) => isAllowedBrowserRequest(request, new Set([
  process.env.NEXT_PUBLIC_PANEL_URL,
  ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim())
].filter((value): value is string => Boolean(value))));

async function authorize(request: NextRequest) {
  const client = await createServerSupabaseClient();
  const userResult = client ? await client.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!client || !user || userResult?.error || !(await hasRequiredInternalMfa(client))
    || !(await consumePanelMutationBudget(request, client))) return null;
  const [profile, role] = await Promise.all([
    client.from("profiles").select("status").eq("id", user.id).maybeSingle(),
    client.from("user_roles").select("role").eq("user_id", user.id).in("role", ["operational", "admin", "technical"])
  ]);
  const roleNames = rows(role.data).map((item) => text(item.role));
  const actorRole = (["technical", "admin", "operational"] as const).find((item) => roleNames.includes(item));
  return !profile.error && profile.data?.status === "active" && !role.error && actorRole
    ? { userId: user.id, actorRole } : null;
}


export async function POST(request: NextRequest) {
  if (!safeOrigin(request)) return NextResponse.json({ ok: false, message: "Origem n?o autorizada." }, { status: 403, headers: noStore });
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ ok: false, message: "Acesso negado." }, { status: panelRateLimitStatus(request), headers: noStore });
  const body = await readJsonResponse(request, 16 * 1024);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, message: "A??o de frete inv?lida." }, { status: 400, headers: noStore });
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ ok: false, message: "Integra??o indispon?vel." }, { status: 503, headers: noStore });
  const { action, shipmentId } = parsed.data;
  try {
    if (action !== "preview" && action !== "print") {
      const queued = await db.rpc("request_shipping_action", { p_shipment_id: shipmentId, p_action: action, p_actor_id: auth.userId });
      if (queued.error || !queued.data) return NextResponse.json({ ok: false,
        message: "A a??o n?o ? permitida neste estado. Sincronize resultados incertos antes de repetir." }, { status: 409, headers: noStore });
      return NextResponse.json({ ok: true, data: { queued: true, jobId: queued.data },
        message: "A??o registrada para processamento seguro. Acompanhe a remessa." }, { status: 202, headers: noStore });
    }
    const result = await db.from("shipments").select("external_id,operation_state").eq("id", shipmentId).eq("provider", "melhorenvio").maybeSingle();
    const shipment = row(result.data);
    if (result.error || !shipment || !text(shipment.external_id)) return NextResponse.json({ ok: false, message: "Remessa indispon?vel." }, { status: 404, headers: noStore });
    if (action === "print" && !["generated", "posted", "delivered"].includes(text(shipment.operation_state)))
      return NextResponse.json({ ok: false, message: "A etiqueta ainda n?o foi confirmada pelo provedor." }, { status: 409, headers: noStore });
    const provider = panelMelhorEnvioProvider();
    const url = action === "print" ? await provider.print([text(shipment.external_id)]) : await provider.preview([text(shipment.external_id)]);
    return NextResponse.json({ ok: true, data: { url } }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({ ok: false, message: "N?o foi poss?vel concluir a consulta ao Melhor Envio." },
      { status: error instanceof MelhorEnvioError ? error.httpStatus : 503, headers: noStore });
  }
}
