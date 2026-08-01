import { createHash, createHmac } from "node:crypto";

type RateLimitClient = {
  rpc(
    name: string,
    args: Record<string, string | number>
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

const localWindows = new Map<string, { count: number; expiresAt: number }>();

const clientAddress = (request: Request): string =>
  request.headers.get("cf-connecting-ip") ??
  request.headers.get("x-real-ip") ??
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "local";

const keyHash = (request: Request, email: string, scope: string): string => {
  const value = `${scope}:${clientAddress(request)}:${email.trim().toLowerCase()}`;
  const secret = process.env.AUDIT_HASH_KEY;
  return secret
    ? createHmac("sha256", secret).update(value).digest("hex")
    : createHash("sha256").update(`development:${value}`).digest("hex");
};

const localAllowed = (key: string, limit: number, windowSeconds: number): boolean => {
  const now = Date.now();
  const current = localWindows.get(key);
  if (!current || current.expiresAt <= now) {
    localWindows.set(key, { count: 1, expiresAt: now + windowSeconds * 1_000 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
};

export async function enforceAuthRateLimit(input: {
  request: Request;
  email: string;
  scope: "login" | "signup" | "password_reset";
  supabase: unknown;
}): Promise<boolean> {
  const limit = input.scope === "login" ? 10 : input.scope === "signup" ? 5 : 3;
  const windowSeconds = input.scope === "login" ? 15 * 60 : 60 * 60;
  const hash = keyHash(input.request, input.email, input.scope);
  if (!input.supabase) return localAllowed(hash, limit, windowSeconds);

  const response = await (input.supabase as RateLimitClient).rpc("enforce_auth_rate_limit", {
    p_scope: input.scope,
    p_key_hash: hash,
    p_limit: limit,
    p_window_seconds: windowSeconds
  });
  if (response.error || typeof response.data !== "boolean") {
    if (process.env.APP_ENV === "production") return false;
    return localAllowed(hash, limit, windowSeconds);
  }
  return response.data;
}
