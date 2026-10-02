import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { consumePanelMutationBudget } from "@/lib/api-rate-limit";
import { safeTechnicalOrigin, technicalNoStore } from "@/lib/technical-api";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function authorized(request: NextRequest) {
  if (verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)) return null;
  const db = await createServerSupabaseClient();
  const userResult = db ? await db.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!db || !user || userResult?.error || !await hasRequiredInternalMfa(db)) return null;
  const [profile, roles] = await Promise.all([
    db.from("profiles").select("status").eq("id", user.id).maybeSingle(),
    db.from("user_roles").select("role").eq("user_id", user.id)
  ]);
  if (profile.error || roles.error || profile.data?.status !== "active"
    || !roles.data?.some((item) => typeof item.role === "string" && ["operational", "admin", "technical", "manager"].includes(item.role))) return null;
  return { db, userId: user.id };
}

export async function GET(request: NextRequest) {
  const auth = await authorized(request);
  if (!auth) return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers: technicalNoStore });
  const filter = request.nextUrl.searchParams.get("filter") ?? "all";
  if (!["all", "pending", "failed", "invoice"].includes(filter))
    return NextResponse.json({ message: "Filtro inválido." }, { status: 400, headers: technicalNoStore });
  const result = await auth.db.rpc("list_bling_order_issues", { p_filter: filter, p_limit: 50 });
  if (result.error) return NextResponse.json({ message: "Pendências indisponíveis." }, { status: 503, headers: technicalNoStore });
  const orders: unknown = result.data;
  return NextResponse.json({ orders: Array.isArray(orders) ? orders : [] }, { headers: technicalNoStore });
}

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: technicalNoStore });
  const auth = await authorized(request);
  if (!auth) return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers: technicalNoStore });
  if (!await consumePanelMutationBudget(request, auth.db))
    return NextResponse.json({ message: "Tente novamente em instantes." }, { status: 429, headers: technicalNoStore });
  const body: unknown = await request.json().catch(() => null);
  const orderId = body && typeof body === "object" && "orderId" in body ? body.orderId : null;
  const action = body && typeof body === "object" && "action" in body ? body.action : "retry";
  if (typeof orderId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(orderId)
    || !["retry", "reconcile"].includes(String(action)))
    return NextResponse.json({ message: "Pedido inválido." }, { status: 400, headers: technicalNoStore });
  const result = await auth.db.rpc(action === "reconcile" ? "enqueue_bling_order_reconciliation" : "retry_bling_order", { p_order_id: orderId });
  if (result.error || result.data !== true) return NextResponse.json({ message: "Reprocessamento indisponível; confira o estado do pedido." },
    { status: 409, headers: technicalNoStore });
  return NextResponse.json({ message: "Sincronização solicitada." }, { headers: technicalNoStore });
}
