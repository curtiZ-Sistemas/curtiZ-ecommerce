import { DEMO_SESSION_COOKIE, demoDestination, safeInternalPath, verifyDemoSession } from "@curtiz/security";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "./supabase/server";
import {
  authorizedSelectablePanels,
  databaseRoleToPanelPath,
  hasPanelRouteAccess,
  type PanelRouteRole
} from "./panel-roles";

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
    return { userId: session.email, roles: session.roles, demo: true, fullName: session.fullName } as const;
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect(storeDestination("/login"));
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user || userResult.error) {
    redirect(storeDestination(`/login?next=${encodeURIComponent(currentPath)}`));
  }

  const [profileResult, roleResult] = await Promise.all([
    supabase.from("profiles").select("full_name,status").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id)
  ]);
  if (profileResult.error || roleResult.error || profileResult.data?.status !== "active") {
    redirect(storeDestination("/403"));
  }

  const assignedRoles = (roleResult.data ?? [])
    .map((item) => (typeof item.role === "string" ? item.role : ""))
    .filter(Boolean);
  if (!hasPanelRouteAccess(assignedRoles, role)) {
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

  const profile = profileResult.data as { full_name?: unknown } | null;
  return {
    userId: user.id,
    roles: assignedRoles,
    demo: false,
    fullName:
      typeof profile?.full_name === "string" && profile.full_name.trim()
        ? profile.full_name.trim()
        : undefined
  } as const;
}

export async function requirePanelSelectionAccess() {
  const currentPath = "/selecionar-painel";
  const cookieStore = await cookies();
  const demoSession = verifyDemoSession(cookieStore.get(DEMO_SESSION_COOKIE)?.value);
  if (demoSession) {
    const allowedPath = databaseRoleToPanelPath(demoSession.roles);
    if (allowedPath) redirect(allowedPath);
    redirect(storeDestination("/403"));
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect(storeDestination("/login"));
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user || userResult.error) redirect(storeDestination("/login"));

  const [profileResult, roleResult] = await Promise.all([
    supabase.from("profiles").select("full_name,status").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id)
  ]);
  const profile = profileResult.data as { full_name?: unknown; status?: unknown } | null;
  if (profileResult.error || roleResult.error || profile?.status !== "active") {
    redirect(storeDestination("/403"));
  }

  const assignedRoles = (roleResult.data ?? [])
    .map((item) => (typeof item.role === "string" ? item.role : ""))
    .filter(Boolean);
  const panels = authorizedSelectablePanels(assignedRoles);
  if (panels.length === 0) {
    if (assignedRoles.includes("technical")) redirect("/tecnico");
    redirect(storeDestination("/403"));
  }
  if (panels.length === 1 && panels[0]) redirect(panels[0].href);

  if (process.env.REQUIRE_INTERNAL_MFA === "true") {
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || assurance.data.currentLevel !== "aal2") {
      const destination = new URL(currentPath, panelUrl()).toString();
      redirect(storeDestination(`/mfa?next=${encodeURIComponent(destination)}`));
    }
  }

  return {
    userId: user.id,
    fullName: typeof profile?.full_name === "string" && profile.full_name.trim() ? profile.full_name : "Usuário",
    roles: assignedRoles,
    panels
  } as const;
}
