import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { safeInternalPath } from "@curtiz/security";
import { resolvePublicAppUrls } from "@curtiz/config";
import { getStoreRuntimeEnvironment, type RuntimeEnvironment } from "./runtime-environment";
import type { createServerSupabaseClient } from "./supabase/server";
import { hasInternalPanelRole, resolveLoginDestination, resolveLoginReturn } from "./auth-routing";
import { isUnknownRecord, readRows, readString } from "./unknown-data";

export const GOOGLE_INTENT_COOKIE = "curtiz-google-intent";
export const googleCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/auth/callback",
  maxAge: 600
};
const intentSchema = z
  .object({
    nonce: z.string().uuid(),
    next: z.string().max(300).optional(),
    remember: z.boolean(),
    marketing: z.boolean(),
    expires: z.number(),
    versions: z.array(z.string().uuid()).max(2)
  })
  .strict();
export type GoogleIntent = z.infer<typeof intentSchema>;
export type AuthClient = NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>;

export function createGoogleIntent(input: Omit<GoogleIntent, "nonce" | "expires">, key: string) {
  if (key.length < 32) throw new Error("OAuth unavailable");
  const intent: GoogleIntent = { ...input, nonce: randomUUID(), expires: Date.now() + 600_000 };
  const value = Buffer.from(JSON.stringify(intent)).toString("base64url");
  return { intent, token: `${value}.${createHmac("sha256", key).update(value).digest("hex")}` };
}

export function readGoogleIntent(
  token: string | undefined,
  nonce: string | null,
  key: string
): GoogleIntent | null {
  if (!token || token.length > 4096 || key.length < 32) return null;
  try {
    const [value, signature, extra] = token.split(".");
    if (!value || !signature || extra || !/^[a-f0-9]{64}$/u.test(signature)) return null;
    const expected = createHmac("sha256", key).update(value).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return null;
    const parsed = intentSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown
    );
    if (
      !parsed.success ||
      parsed.data.nonce !== nonce ||
      parsed.data.expires <= Date.now() ||
      parsed.data.expires > Date.now() + 600_000
    )
      return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function googleAuthReady(values?: RuntimeEnvironment): Promise<boolean> {
  try {
    const environment = values ?? getStoreRuntimeEnvironment();
    if (
      environment.GOOGLE_AUTH_ENABLED !== "true" ||
      (environment.RATE_LIMIT_HMAC_KEY?.length ?? 0) < 32
    )
      return false;
    const url = new URL(environment.SUPABASE_URL ?? "");
    const key = environment.SUPABASE_PUBLISHABLE_KEY;
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      !key
    )
      return false;
    const response = await fetch(new URL("/auth/v1/settings", url), {
      headers: { apikey: key },
      signal: AbortSignal.timeout(5000),
      cache: "no-store"
    });
    if (!response.ok) return false;
    const settings: unknown = await response.json();
    return (
      isUnknownRecord(settings) &&
      isUnknownRecord(settings.external) &&
      settings.external.google === true
    );
  } catch {
    return false;
  }
}

export async function googleLoginDestination(
  client: AuthClient,
  userId: string,
  requested: string | undefined,
  requestUrl: string,
  environment: RuntimeEnvironment
): Promise<string> {
  const [profile, assigned] = await Promise.all([
    client.from("profiles").select("status").eq("id", userId).maybeSingle(),
    client.from("user_roles").select("role").eq("user_id", userId)
  ]);
  if (
    profile.error ||
    assigned.error ||
    !isUnknownRecord(profile.data) ||
    profile.data.status !== "active"
  ) {
    throw new Error("Account unavailable");
  }
  const roles = readRows(assigned.data).map((row) => readString(row, "role"));
  const fallback = resolveLoginDestination(roles);
  if (!fallback) throw new Error("Roles unavailable");
  const { storeUrl, panelUrl } = resolvePublicAppUrls(requestUrl);
  let destination = resolveLoginReturn(safeInternalPath(requested, fallback), panelUrl);
  if (
    new URL(destination, storeUrl).origin === new URL(panelUrl).origin &&
    !hasInternalPanelRole(roles)
  )
    destination = "/minha-conta";
  if (hasInternalPanelRole(roles) && environment.REQUIRE_INTERNAL_MFA === "true") {
    const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) throw new Error("MFA unavailable");
    if (assurance.data.currentLevel !== "aal2")
      destination = `/mfa?next=${encodeURIComponent(destination)}`;
  }
  if (hasInternalPanelRole(roles))
    await client.rpc("log_internal_auth_event", { p_event: "LOGIN" });
  return new URL(destination, storeUrl).toString();
}

export async function recordGoogleConsents(
  client: AuthClient,
  userId: string,
  intent: GoogleIntent
) {
  const version = intent.versions.length ? `legal:${intent.versions.join(",")}` : "legacy:2026-08";
  for (const consentType of ["terms_and_privacy", ...(intent.marketing ? ["marketing"] : [])]) {
    const existing = await client
      .from("customer_consents")
      .select("id")
      .eq("user_id", userId)
      .eq("consent_type", consentType)
      .eq("accepted", true)
      .eq("version", version)
      .limit(1)
      .maybeSingle();
    if (existing.error) throw new Error("Consent unavailable");
    if (!existing.data) {
      const insertion = await client
        .from("customer_consents")
        .insert({ user_id: userId, consent_type: consentType, accepted: true, version });
      if (insertion.error) throw new Error("Consent unavailable");
    }
  }
  if (intent.versions.length) {
    const result = await client.rpc("record_legal_acceptances", {
      p_context: "signup",
      p_version_ids: intent.versions
    });
    if (result.error) throw new Error("Legal acceptance unavailable");
  }
}
