import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const configured = new Set([
    new URL(request.url).origin,
    process.env.NEXT_PUBLIC_PANEL_URL,
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim())
  ]);
  return configured.has(origin);
}

export async function authorizeAdminRequest(request: NextRequest) {
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
    !roles.includes("admin")
  ) {
    return null;
  }
  return { supabase, userId: user.id };
}

export function unauthorizedAdminResponse() {
  return NextResponse.json(
    { message: "Sua sessão não permite esta operação." },
    { status: 401, headers: privateNoStore }
  );
}
