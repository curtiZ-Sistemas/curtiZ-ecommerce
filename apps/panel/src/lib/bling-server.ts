import "server-only";

import { BlingError, createBlingClient, type BlingClient } from "@curtiz/integrations";
import type { createServiceSupabaseClient } from "./supabase/server";
import type { NextRequest } from "next/server";
import { authorizeTechnicalRequest } from "./technical-api";
import { createServerSupabaseClient } from "./supabase/server";
import { hasRequiredInternalMfa } from "./internal-mfa";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";

type Database = NonNullable<ReturnType<typeof createServiceSupabaseClient>>;
export const blingEnvironment = () => process.env.APP_ENV === "production" ? "production" : "sandbox";
export const blingConfigured = () => Boolean(process.env.BLING_CLIENT_ID?.trim()
  && process.env.BLING_CLIENT_SECRET?.trim() && process.env.BLING_TOKEN_ENCRYPTION_KEY?.trim()
  && process.env.BLING_REDIRECT_URI?.trim());

export async function authorizeBlingTechnicalRequest(request: NextRequest, options: { mutation?: boolean } = {}) {
  const auth = await authorizeTechnicalRequest(request, options);
  if (!auth) return null;
  const permission = await auth.supabase.rpc("has_permission", { permission_code: "technical.integrations.manage" });
  return !permission.error && permission.data === true ? auth : null;
}

export async function authorizeBlingPanelRequest(request: NextRequest) {
  if (verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)) return null;
  const db = await createServerSupabaseClient();
  const session = db ? await db.auth.getUser() : null;
  if (!db || session?.error || !session?.data.user || !await hasRequiredInternalMfa(db)) return null;
  const [profile, roles] = await Promise.all([
    db.from("profiles").select("status").eq("id", session.data.user.id).maybeSingle(),
    db.from("user_roles").select("role").eq("user_id", session.data.user.id)
  ]);
  if (profile.error || roles.error || profile.data?.status !== "active"
    || !roles.data?.some((role) => typeof role.role === "string" && ["admin", "manager", "operational", "technical"].includes(role.role))) return null;
  // Each authenticated RPC enforces active profile, permissions and applicable MFA in PostgreSQL.
  return db;
}

export function panelBlingClient(db: Database): BlingClient {
  return createBlingClient(process.env, async (name, args) => db.rpc(name, args));
}

export function blingCallbackUrl(): URL {
  const value = process.env.BLING_REDIRECT_URI?.trim() ?? "";
  let url: URL;
  try { url = new URL(value); } catch { throw new BlingError("configuration", 503); }
  if (url.protocol !== "https:" || url.pathname !== "/api/integrations/bling/callback"
    || url.search || url.hash || url.username || url.password) throw new BlingError("configuration", 503);
  return url;
}
