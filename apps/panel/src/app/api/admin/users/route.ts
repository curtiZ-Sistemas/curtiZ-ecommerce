import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeAdminRequest,
  objectRows,
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "@/lib/admin-api";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["active", "suspended", "disabled"]),
  role: z.enum(["customer", "operational", "manager", "technical"]),
  reason: z.string().trim().min(10).max(500)
});

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse();
  const page = Math.max(
    1,
    Math.min(10_000, Number(request.nextUrl.searchParams.get("page")) || 1)
  );
  const q = (request.nextUrl.searchParams.get("q") ?? "")
    .replaceAll(/[^\p{L}\p{N}\s@.+-]/gu, " ")
    .trim()
    .slice(0, 80);
  const pageSize = 20;
  let query = auth.supabase
    .from("profiles")
    .select("id,full_name,email_snapshot,status,created_at,user_roles(role)", { count: "exact" });
  if (q) query = query.or(`full_name.ilike.%${q}%,email_snapshot.ilike.%${q}%`);
  const result = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (result.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar os usuários." },
      { status: 503, headers: privateNoStore }
    );
  }
  const userRows = objectRows(result.data);
  const userIds = userRows
    .map((user) => (typeof user.id === "string" ? user.id : ""))
    .filter(Boolean);
  const historyResult = userIds.length
    ? await auth.supabase
        .from("audit_logs")
        .select("entity_id,action,reason,created_at")
        .eq("entity_type", "profiles")
        .in("entity_id", userIds)
        .in("action", ["update_access", "permission_override"])
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  const historyByUser = new Map<string, Record<string, unknown>>();
  for (const history of objectRows(historyResult.data)) {
    const entityId = typeof history.entity_id === "string" ? history.entity_id : "";
    if (entityId && !historyByUser.has(entityId)) historyByUser.set(entityId, history);
  }
  const users = userRows.map((user) => {
    const roles = objectRows(user.user_roles)
      .map((role) => (typeof role.role === "string" ? role.role : ""))
      .filter(Boolean);
    const userId = typeof user.id === "string" ? user.id : "";
    return {
      ...user,
      roles,
      editable: Boolean(userId) && userId !== auth.userId && !roles.includes("admin"),
      lastAccessChange: userId ? (historyByUser.get(userId) ?? null) : null,
      user_roles: undefined
    };
  });
  return NextResponse.json(
    { users, total: result.count ?? 0, page, pageSize },
    { headers: privateNoStore }
  );
}

export async function PATCH(request: NextRequest) {
  if (!safePanelOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  }
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse();
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Informe status, papel e justificativa válida." },
      { status: 400, headers: privateNoStore }
    );
  }
  const result = await auth.supabase.rpc("admin_update_user_access", {
    p_user_id: parsed.data.userId,
    p_status: parsed.data.status,
    p_role: parsed.data.role,
    p_reason: parsed.data.reason
  });
  if (result.error) {
    return NextResponse.json(
      { message: "Não foi possível alterar este acesso." },
      { status: result.error.code === "42501" ? 403 : 409, headers: privateNoStore }
    );
  }
  return NextResponse.json(
    { message: "Acesso atualizado e auditado." },
    { headers: privateNoStore }
  );
}
