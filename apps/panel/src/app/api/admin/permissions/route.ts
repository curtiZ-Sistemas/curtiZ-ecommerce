import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeAdminRequest,
  objectRows,
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "@/lib/admin-api";

const overrideSchema = z.object({
  userId: z.string().uuid(),
  permissionCode: z.string().min(3).max(120),
  allowed: z.boolean(),
  expiresAt: z.string().datetime(),
  reason: z.string().trim().min(10).max(500)
});

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse();
  const [permissions, users, overrides] = await Promise.all([
    auth.supabase.from("permissions").select("id,code,description").order("code"),
    auth.supabase
      .from("profiles")
      .select("id,full_name,status,user_roles(role)")
      .eq("status", "active")
      .limit(200),
    auth.supabase
      .from("user_permission_overrides")
      .select("user_id,allowed,reason,expires_at,permissions(code)")
      .order("created_at", { ascending: false })
      .limit(30)
  ]);
  if (permissions.error || users.error || overrides.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar as permissões." },
      { status: 503, headers: privateNoStore }
    );
  }
  return NextResponse.json(
    {
      permissions: objectRows(permissions.data),
      users: objectRows(users.data)
        .filter((user) => !objectRows(user.user_roles).some((role) => role.role === "admin"))
        .map((user) => ({ id: user.id, fullName: user.full_name })),
      overrides: objectRows(overrides.data)
    },
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
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse();
  const parsed = overrideSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Revise usuário, permissão, validade e justificativa." },
      { status: 400, headers: privateNoStore }
    );
  }
  const result = await auth.supabase.rpc("admin_set_permission_override", {
    p_user_id: parsed.data.userId,
    p_permission_code: parsed.data.permissionCode,
    p_allowed: parsed.data.allowed,
    p_expires_at: parsed.data.expiresAt,
    p_reason: parsed.data.reason
  });
  if (result.error) {
    return NextResponse.json(
      { message: "Não foi possível aplicar esta permissão." },
      { status: result.error.code === "42501" ? 403 : 409, headers: privateNoStore }
    );
  }
  return NextResponse.json(
    { message: "Permissão temporária registrada e auditada." },
    { headers: privateNoStore }
  );
}
