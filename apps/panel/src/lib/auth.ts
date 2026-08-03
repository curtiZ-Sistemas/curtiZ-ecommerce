import { DEMO_SESSION_COOKIE, demoDestination, safeInternalPath, verifyDemoSession } from "@curtiz/security";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "./supabase/server";
import { databaseRoleToPanelPath, panelRoleToDatabaseRole, type PanelRouteRole } from "./panel-roles";

const storeUrl = () => process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000";
const panelUrl = () => process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001";

const storeDestination = (path: string) => new URL(path, storeUrl()).toString();

export async function requirePanelAccess(role: PanelRouteRole, currentPath: string) {
  const cookieStore = await cookies();
  const session = verifyDemoSession(cookieStore.get(DEMO_SESSION_COOKIE)?.value);
  if (session) {
    if (session.role === "customer" || session.role === "representative") {
      redirect(storeDestination(`/login?next=${encodeURIComponent(currentPath)}`));
    }
    const allowed = demoDestination(session.role);
    if (`/${role}` !== allowed) redirect(allowed);
    return { userId: session.email, roles: session.roles, demo: true } as const;
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect(storeDestination("/login"));
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user || userResult.error) {
    redirect(storeDestination(`/login?next=${encodeURIComponent(currentPath)}`));
  }

  const [profileResult, roleResult] = await Promise.all([
    supabase.from("profiles").select("status").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id)
  ]);
  if (profileResult.error || roleResult.error || profileResult.data?.status !== "active") {
    redirect(storeDestination("/403"));
  }

  const assignedRoles = (roleResult.data ?? [])
    .map((item) => (typeof item.role === "string" ? item.role : ""))
    .filter(Boolean);
  const expectedRole = panelRoleToDatabaseRole[role];
  if (!assignedRoles.includes(expectedRole)) {
    const allowedPath = databaseRoleToPanelPath(assignedRoles);
    if (allowedPath) redirect(allowedPath);
    redirect(storeDestination("/403"));
  }

  if (process.env.REQUIRE_INTERNAL_MFA === "true") {
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || assurance.data.currentLevel !== "aal2") {
      const safePath = safeInternalPath(currentPath, `/${role}`);
      const destination = new URL(safePath, panelUrl()).toString();
      redirect(storeDestination(`/mfa?next=${encodeURIComponent(destination)}`));
    }
  }

  return { userId: user.id, roles: assignedRoles, demo: false } as const;
}
