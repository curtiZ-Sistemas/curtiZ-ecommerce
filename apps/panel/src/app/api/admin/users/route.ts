import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeAdminRequest,
  objectRows,
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "@/lib/admin-api";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["active", "suspended", "disabled"]),
  roles: z.array(z.enum(["customer", "admin", "operational", "technical"])).max(4),
  updatedAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(10).max(500)
});

const inviteSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(["customer", "admin", "operational"]),
  reason: z.string().trim().min(10).max(500)
});

async function hasPermission(
  supabase: NonNullable<Awaited<ReturnType<typeof authorizeAdminRequest>>>["supabase"],
  permissionCode: string
) {
  const result = await supabase.rpc("has_permission", { permission_code: permissionCode });
  return { allowed: result.data === true, error: result.error };
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request, ["manager", "technical"]);
  if (!auth) return unauthorizedAdminResponse();
  const [readPermission, clientPermission, adminPermission, operatorPermission, technicalPermission, createPermission] = await Promise.all([
    hasPermission(auth.supabase, "users.read"),
    hasPermission(auth.supabase, "users.access.manage_client"),
    hasPermission(auth.supabase, "users.access.manage_admin"),
    hasPermission(auth.supabase, "users.access.manage_operator"),
    hasPermission(auth.supabase, "users.access.manage_technical"),
    hasPermission(auth.supabase, "users.create_internal")
  ]);
  if (readPermission.error || clientPermission.error || adminPermission.error || operatorPermission.error || technicalPermission.error || createPermission.error) {
    return NextResponse.json(
      { message: "Não foi possível confirmar as permissões de usuários." },
      { status: 503, headers: privateNoStore }
    );
  }
  if (!readPermission.allowed) {
    return NextResponse.json(
      { message: "Sua permissão não permite consultar usuários." },
      { status: 403, headers: privateNoStore }
    );
  }
  const manageableRoles = [
    clientPermission.allowed ? "customer" : null,
    adminPermission.allowed ? "admin" : null,
    operatorPermission.allowed ? "operational" : null,
    technicalPermission.allowed ? "technical" : null
  ].filter((role): role is string => Boolean(role));
  const canManage = manageableRoles.length > 0;
  const canInvite = createPermission.allowed && clientPermission.allowed;
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
    .select("id,full_name,email_snapshot,status,created_at,updated_at,user_roles(role)", { count: "exact" });
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
        .in("action", ["update_access", "permission_override", "user_access.changed"])
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
      editable: canManage && Boolean(userId) && userId !== auth.userId,
      lastAccessChange: userId ? (historyByUser.get(userId) ?? null) : null,
      user_roles: undefined
    };
  });
  return NextResponse.json(
    { users, total: result.count ?? 0, page, pageSize, capabilities: { manage: canManage, invite: canInvite, manageableRoles, canManageStatus: clientPermission.allowed } },
    { headers: privateNoStore }
  );
}

export async function POST(request: NextRequest) {
  if (!safePanelOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  }
  const auth = await authorizeAdminRequest(request, ["manager"]);
  if (!auth) return unauthorizedAdminResponse();
  const [createPermission, clientPermission, adminPermission, operatorPermission] = await Promise.all([
    hasPermission(auth.supabase, "users.create_internal"),
    hasPermission(auth.supabase, "users.access.manage_client"),
    hasPermission(auth.supabase, "users.access.manage_admin"),
    hasPermission(auth.supabase, "users.access.manage_operator")
  ]);
  if (createPermission.error || clientPermission.error || adminPermission.error || operatorPermission.error) {
    return NextResponse.json(
      { message: "Não foi possível confirmar sua permissão agora." },
      { status: 503, headers: privateNoStore }
    );
  }
  if (!createPermission.allowed || !clientPermission.allowed || !adminPermission.allowed || !operatorPermission.allowed) {
    return NextResponse.json(
      { message: "Sua permissão não permite convidar usuários internos." },
      { status: 403, headers: privateNoStore }
    );
  }
  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Informe nome, e-mail, papel e justificativa válidos." },
      { status: 400, headers: privateNoStore }
    );
  }
  const service = createServiceSupabaseClient();
  if (!service) {
    return NextResponse.json(
      { message: "O serviço de convites internos não está configurado." },
      { status: 503, headers: privateNoStore }
    );
  }
  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL;
  const redirectTo = storeUrl
    ? new URL("/auth/callback?next=/minha-conta", storeUrl).toString()
    : undefined;
  const invitation = await service.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: { full_name: parsed.data.fullName, internal_invite: true },
    ...(redirectTo ? { redirectTo } : {})
  });
  const invitedUser = invitation.data.user;
  if (invitation.error || !invitedUser) {
    return NextResponse.json(
      { message: "Não foi possível enviar o convite. Confirme se o e-mail já possui acesso." },
      { status: 409, headers: privateNoStore }
    );
  }
  const profile = await auth.supabase.from("profiles").select("updated_at").eq("id", invitedUser.id).single();
  const invitedProfile = objectRows([profile.data])[0];
  const invitedUpdatedAt = typeof invitedProfile?.updated_at === "string" ? invitedProfile.updated_at : "";
  if (profile.error || !invitedUpdatedAt) {
    await service.auth.admin.deleteUser(invitedUser.id);
    return NextResponse.json(
      { message: "O convite foi cancelado porque o perfil não pôde ser confirmado." },
      { status: 409, headers: privateNoStore }
    );
  }
  const access = await auth.supabase.rpc("manage_user_access", {
    p_user_id: invitedUser.id,
    p_status: "active",
    p_roles: [parsed.data.role],
    p_reason: parsed.data.reason,
    p_expected_updated_at: invitedUpdatedAt
  });
  if (access.error) {
    await service.auth.admin.deleteUser(invitedUser.id);
    return NextResponse.json(
      { message: "O convite foi cancelado porque o acesso não pôde ser configurado." },
      { status: 409, headers: privateNoStore }
    );
  }
  return NextResponse.json(
    { message: "Convite enviado e acesso interno configurado." },
    { status: 201, headers: privateNoStore }
  );
}

export async function PATCH(request: NextRequest) {
  if (!safePanelOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  }
  const auth = await authorizeAdminRequest(request, ["manager", "technical"]);
  if (!auth) return unauthorizedAdminResponse();
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Informe status, acessos e justificativa válidos." },
      { status: 400, headers: privateNoStore }
    );
  }
  const result = await auth.supabase.rpc("manage_user_access", {
    p_user_id: parsed.data.userId,
    p_status: parsed.data.status,
    p_roles: parsed.data.roles,
    p_reason: parsed.data.reason,
    p_expected_updated_at: parsed.data.updatedAt
  });
  if (result.error) {
    return NextResponse.json(
      { message: result.error.code === "40001" ? "Os acessos mudaram em outra sessão. Recarregue e revise novamente." : "Não foi possível alterar este acesso." },
      { status: result.error.code === "42501" ? 403 : 409, headers: privateNoStore }
    );
  }
  return NextResponse.json(
    { message: "Acesso atualizado e auditado." },
    { headers: privateNoStore }
  );
}
