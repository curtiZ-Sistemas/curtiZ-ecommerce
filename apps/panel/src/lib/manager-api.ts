import { DEMO_SESSION_COOKIE, isAllowedBrowserRequest, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "./supabase/server";
import { hasRequiredInternalMfa } from "./internal-mfa";
import { consumePanelMutationBudget, panelRateLimitStatus } from "./api-rate-limit";

export const managerNoStore = { "cache-control": "private, no-store" };

export type ManagerRecord = Record<string, unknown>;

export function managerRows(value: unknown): ManagerRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is ManagerRecord =>
          item !== null && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

export function safeManagerOrigin(request: NextRequest): boolean {
  const configured = new Set([
    process.env.NEXT_PUBLIC_PANEL_URL,
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim())
  ].filter((value): value is string => Boolean(value)));
  return isAllowedBrowserRequest(request, configured);
}

export async function authorizeManagerRequest(request: NextRequest) {
  const demo = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demo) return null;

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!supabase || !user || userResult?.error) return null;

  const [profileResult, roleResult] = await Promise.all([
    supabase.from("profiles").select("status").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id)
  ]);
  const roles = managerRows(roleResult.data).map((item) =>
    typeof item.role === "string" ? item.role : ""
  );

  if (
    profileResult.error ||
    roleResult.error ||
    profileResult.data?.status !== "active" ||
    !roles.includes("manager")
  ) {
    return null;
  }

  if (!(await hasRequiredInternalMfa(supabase))) return null;
  if (!(await consumePanelMutationBudget(request, supabase))) return null;
  return { supabase, userId: user.id };
}

export function unauthorizedManagerResponse(request?: NextRequest) {
  return NextResponse.json(
    { message: "Sua sessão não permite acessar dados gerenciais." },
    { status: panelRateLimitStatus(request), headers: managerNoStore }
  );
}
