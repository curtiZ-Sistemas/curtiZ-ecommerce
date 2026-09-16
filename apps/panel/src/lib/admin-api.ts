import { DEMO_SESSION_COOKIE, isAllowedBrowserRequest, readBoundedJson, RequestBodyError, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasRequiredInternalMfa } from "./internal-mfa";
import { consumePanelMutationBudget, panelRateLimitStatus } from "./api-rate-limit";

type UnknownRecord = Record<string, unknown>;

export const privateNoStore = { "cache-control": "private, no-store" };

export function objectRows(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is UnknownRecord =>
          item !== null && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

export function safePanelOrigin(request: NextRequest) {
  const configured = new Set([
    process.env.NEXT_PUBLIC_PANEL_URL,
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim())
  ].filter((value): value is string => Boolean(value)));
  return isAllowedBrowserRequest(request, configured);
}

export async function readPanelJson(request: NextRequest, maximumBytes = 64 * 1024): Promise<unknown> {
  try {
    return await readBoundedJson(request, maximumBytes);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return NextResponse.json(
      { message: status === 413 ? "A requisição excede o limite permitido." : "Corpo JSON inválido." },
      { status, headers: privateNoStore }
    );
  }
}

export async function authorizeAdminRequest(
  request: NextRequest,
  allowedRoles: readonly string[] = ["admin"]
) {
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
  const roles = objectRows(roleResult.data).map((item) =>
    typeof item.role === "string" ? item.role : ""
  );
  if (
    profileResult.error ||
    roleResult.error ||
    profileResult.data?.status !== "active" ||
    !roles.some((role) => allowedRoles.includes(role))
  ) {
    return null;
  }
  if (!(await hasRequiredInternalMfa(supabase))) return null;
  if (!(await consumePanelMutationBudget(request, supabase))) return null;
  return { supabase, userId: user.id };
}

export function unauthorizedAdminResponse(request?: NextRequest) {
  return NextResponse.json(
    { message: "Sua sessão não permite esta operação." },
    { status: panelRateLimitStatus(request), headers: privateNoStore }
  );
}
