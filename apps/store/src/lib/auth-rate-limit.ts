import { createHash, createHmac } from "node:crypto";
import { normalizeEmail } from "./signup-validation";

export type RateLimitResult =
  | { status: "allowed"; remaining?: number }
  | { status: "blocked"; retryAfterSeconds: number }
  | { status: "error" };

type RateLimitClient = {
  rpc(name: string, args: Record<string, string | number>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

type RateLimitScope = "login" | "signup" | "password_reset" | "privacy_request";
const localWindows = new Map<string, { count: number; expiresAt: number }>();

const keyHash = (value: string): string => {
  const secret = process.env.RATE_LIMIT_HMAC_KEY;
  return secret
    ? createHmac("sha256", secret).update(value).digest("hex")
    : createHash("sha256").update(`development:${value}`).digest("hex");
};

const localResult = (key: string, limit: number, windowSeconds: number): RateLimitResult => {
  const now = Date.now();
  if (localWindows.size >= 2_000) {
    for (const [entry, window] of localWindows) {
      if (window.expiresAt <= now) localWindows.delete(entry);
    }
    if (localWindows.size >= 2_000 && !localWindows.has(key)) return { status: "error" };
  }
  const current = localWindows.get(key);
  const window = !current || current.expiresAt <= now
    ? { count: 0, expiresAt: now + windowSeconds * 1_000 }
    : current;
  window.count += 1;
  localWindows.set(key, window);
  if (window.count > limit) {
    return { status: "blocked", retryAfterSeconds: Math.max(1, Math.ceil((window.expiresAt - now) / 1_000)) };
  }
  return { status: "allowed", remaining: limit - window.count };
};

const readResult = (value: unknown): RateLimitResult | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.status === "allowed" && Number.isSafeInteger(record.remaining) && Number(record.remaining) >= 0) {
    return { status: "allowed", remaining: Number(record.remaining) };
  }
  if (record.status === "blocked" && Number.isSafeInteger(record.retryAfterSeconds)
    && Number(record.retryAfterSeconds) > 0) {
    return { status: "blocked", retryAfterSeconds: Number(record.retryAfterSeconds) };
  }
  return null;
};

async function enforceBudget(input: {
  email: string;
  scope: RateLimitScope;
  supabase: unknown;
}): Promise<RateLimitResult> {
  const production = process.env.APP_ENV === "production" || process.env.NODE_ENV === "production";
  const secretReady = (process.env.RATE_LIMIT_HMAC_KEY?.length ?? 0) >= 32;
  if (production && (!input.supabase || !secretReady)) return { status: "error" };
  const limit = input.scope === "login" ? 10 : input.scope === "signup" ? 5 : 3;
  const windowSeconds = input.scope === "login" ? 15 * 60 : 60 * 60;
  const hash = keyHash(`${input.scope}:account:${normalizeEmail(input.email)}`);
  if (!input.supabase) return localResult(hash, limit, windowSeconds);
  try {
    const response = await (input.supabase as RateLimitClient).rpc("consume_auth_rate_limit", {
      p_scope: input.scope,
      p_key_hash: hash,
      p_limit: limit,
      p_window_seconds: windowSeconds
    });
    if (response.error) return { status: "error" };
    return readResult(response.data) ?? { status: "error" };
  } catch {
    return { status: "error" };
  }
}

export async function enforceAuthRateLimit(input: {
  request: Request;
  email: string;
  scope: Exclude<RateLimitScope, "privacy_request">;
  supabase: unknown;
}): Promise<RateLimitResult> {
  return enforceBudget(input);
}

export async function enforcePrivacyRequestRateLimit(input: {
  request: Request;
  email: string;
  supabase: unknown;
}): Promise<RateLimitResult> {
  return enforceBudget({ ...input, scope: "privacy_request" });
}
