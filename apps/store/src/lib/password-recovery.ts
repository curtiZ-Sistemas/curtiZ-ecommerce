import type { createServerSupabaseClient } from "./supabase/server";

type ServerSupabase = NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>;

export const RECOVERY_PATH = "/redefinir-senha";
export const RECOVERY_REQUEST_PATH = "/esqueci-senha";
/** A recovery link may only authorize a password change for a short time after it was opened. */
export const RECOVERY_WINDOW_SECONDS = 15 * 60;

export type RecoveryRefusal =
  | "unauthenticated"
  | "not_recovery"
  | "expired"
  | "no_password_identity"
  | "inactive";
export type RecoveryCheck = { status: "ok"; userId: string } | { status: RecoveryRefusal };

type RecoveryUser = {
  id: string;
  identities?: Array<{ provider?: string }> | null;
};
type ResetError = { name?: string; code?: string; status?: number; message?: string };

const decodeClaims = (accessToken: string): Record<string, unknown> | null => {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/gu, "+").replace(/_/gu, "/");
    const parsed: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/**
 * Reads the newest "recovery" entry of the session's authentication methods (amr claim).
 * Callers must only pass a token the Auth server just issued or verified.
 */
export function recoveryAuthenticatedAt(accessToken: string | undefined): number | null {
  const amr = accessToken ? decodeClaims(accessToken)?.amr : null;
  if (!Array.isArray(amr)) return null;
  let newest: number | null = null;
  for (const entry of amr) {
    if (!entry || typeof entry !== "object") continue;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (method === "recovery" && typeof timestamp === "number" && Number.isFinite(timestamp)) {
      newest = newest === null ? timestamp : Math.max(newest, timestamp);
    }
  }
  return newest;
}

export const hasPasswordIdentity = (user: RecoveryUser): boolean =>
  Boolean(user.identities?.some((identity) => identity.provider === "email"));

export function recoveryFreshness(
  accessToken: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1_000)
): "ok" | "not_recovery" | "expired" {
  const at = recoveryAuthenticatedAt(accessToken);
  if (at === null) return "not_recovery";
  return at > nowSeconds + 60 || nowSeconds - at > RECOVERY_WINDOW_SECONDS ? "expired" : "ok";
}

/**
 * Proves that the current session came from an official recovery link, not from an ordinary
 * password or Google login. `getUser()` makes the Auth server validate the token first.
 */
export async function verifyRecoverySession(supabase: ServerSupabase): Promise<RecoveryCheck> {
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user) return { status: "unauthenticated" };
  const session = await supabase.auth.getSession();
  const freshness = recoveryFreshness(session.data.session?.access_token);
  if (freshness !== "ok") return { status: freshness };
  if (!hasPasswordIdentity(user)) return { status: "no_password_identity" };
  const profile = await supabase.from("profiles").select("status").eq("id", user.id).maybeSingle();
  if (profile.error || profile.data?.status !== "active") return { status: "inactive" };
  return { status: "ok", userId: user.id };
}

export type ResetOutcome = "neutral" | "unavailable";

const PER_ACCOUNT_LIMIT = /only request this after|for security purposes/iu;

/**
 * Maps the Auth response to what the browser may learn. Anything that depends on the account
 * existing (per-user cooldown, validation) stays neutral; only provider-wide failures surface.
 */
export function classifyResetError(error: ResetError | null | undefined): {
  outcome: ResetOutcome;
  category: string;
  status: number | null;
} {
  if (!error) return { outcome: "neutral", category: "sent", status: null };
  const status = typeof error.status === "number" ? error.status : null;
  if (error.name === "AuthRetryableFetchError" || status === null || status === 0 || status >= 500) {
    return { outcome: "unavailable", category: "provider_unavailable", status };
  }
  if (status === 429) {
    return PER_ACCOUNT_LIMIT.test(error.message ?? "")
      ? { outcome: "neutral", category: "account_cooldown", status }
      : { outcome: "unavailable", category: "provider_rate_limited", status };
  }
  return { outcome: "neutral", category: "rejected", status };
}
