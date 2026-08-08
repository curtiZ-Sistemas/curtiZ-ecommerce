import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { type TechnicalRecord } from "@/lib/technical-sanitizer";

export { sanitizeTechnicalValue } from "@/lib/technical-sanitizer";
export { technicalDemoResourceRows } from "./technical-demo";

export const technicalNoStore = { "cache-control": "private, no-store" };

export function isAuthorizedTechnicalDemo(request: NextRequest): boolean {
  const session = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  return Boolean(session?.roles.includes("technical"));
}

export function technicalRows(value: unknown): TechnicalRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is TechnicalRecord =>
          item !== null && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

export function safeTechnicalOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return new Set([
    new URL(request.url).origin,
    process.env.NEXT_PUBLIC_PANEL_URL,
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim())
  ]).has(origin);
}

export async function authorizeTechnicalRequest(request: NextRequest) {
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
  const roles = technicalRows(roleResult.data).flatMap((item) =>
    typeof item.role === "string" ? [item.role] : []
  );
  if (
    profileResult.error ||
    roleResult.error ||
    profileResult.data?.status !== "active" ||
    !roles.includes("technical")
  ) {
    return null;
  }
  return { supabase, userId: user.id };
}

export function unauthorizedTechnicalResponse() {
  return NextResponse.json(
    { message: "Sua sessão não permite acessar dados técnicos." },
    { status: 401, headers: technicalNoStore }
  );
}
