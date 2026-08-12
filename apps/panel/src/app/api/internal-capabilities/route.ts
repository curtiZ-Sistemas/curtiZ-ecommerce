import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest, privateNoStore, unauthorizedAdminResponse } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

const permissions = [
  "creatives.manage",
  "creatives.approve",
  "creatives.publish",
  "representatives.manage"
] as const;

export async function GET(request: NextRequest) {
  const demo = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demo) {
    const allowed = demo.roles.some((role) => role === "admin" || role === "manager");
    return NextResponse.json(
      {
        capabilities: Object.fromEntries(permissions.map((permission) => [permission, allowed]))
      },
      { headers: privateNoStore }
    );
  }

  const auth = await authorizeAdminRequest(request, ["admin", "manager"]);
  if (!auth) return unauthorizedAdminResponse();
  const results = await Promise.all(
    permissions.map((permissionCode) =>
      auth.supabase.rpc("has_permission", { permission_code: permissionCode })
    )
  );
  if (results.some((result) => result.error)) {
    return NextResponse.json(
      { message: "Não foi possível confirmar as permissões desta área." },
      { status: 503, headers: privateNoStore }
    );
  }
  return NextResponse.json(
    {
      capabilities: Object.fromEntries(
        permissions.map((permission, index) => [permission, results[index]?.data === true])
      )
    },
    { headers: privateNoStore }
  );
}
