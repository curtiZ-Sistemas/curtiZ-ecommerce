import "server-only";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import type { NextRequest } from "next/server";
import { PrivateRequestError, requirePrivateRateLimit } from "./private-request";
import { createServerSupabaseClient } from "./supabase/server";
import { readQueryResult, readRows, readString } from "./unknown-data";

type AppRole = "customer" | "operational" | "admin" | "manager" | "technical";

export type SupportActor = {
  kind: "demo" | "supabase";
  email: string;
  fullName: string;
  role: AppRole;
  userId: string | null;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
};

export async function getSupportActor(request: NextRequest, scope = request.method === "GET" ? "support_read" : "support_write"): Promise<SupportActor | null> {
  const demoSession = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demoSession) {
    return {
      kind: "demo",
      email: demoSession.email,
      fullName: demoSession.fullName,
      role: demoSession.role === "representative" ? "customer" : demoSession.role,
      userId: null,
      supabase: null
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const profile = await supabase.from("profiles").select("status").eq("id", data.user.id).maybeSingle();
  if (profile.error) throw new PrivateRequestError(503);
  if (profile.data?.status !== "active") throw new PrivateRequestError(403);
  await requirePrivateRateLimit(supabase, scope);
  const roleResponse: unknown = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id);
  if (readQueryResult(roleResponse).error) throw new PrivateRequestError(503);
  const roleValue = readRows(readQueryResult(roleResponse).data)
    .map((item) => readString(item, "role"))
    .find((role) => ["operational", "admin", "manager", "technical"].includes(role));
  const role: AppRole =
    roleValue === "operational" ||
    roleValue === "admin" ||
    roleValue === "manager" ||
    roleValue === "technical"
      ? roleValue
      : "customer";
  if (role !== "customer" && process.env.REQUIRE_INTERNAL_MFA === "true") {
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || assurance.data.currentLevel !== "aal2") throw new PrivateRequestError(403);
  }
  const metadataName: unknown = data.user.user_metadata.full_name;
  return {
    kind: "supabase",
    email: data.user.email ?? "",
    fullName: typeof metadataName === "string" ? metadataName : "Cliente curti Z",
    role,
    userId: data.user.id,
    supabase
  };
}

