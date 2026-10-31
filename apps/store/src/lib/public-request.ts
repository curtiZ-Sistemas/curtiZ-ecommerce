import "server-only";
import { createHmac, createHash } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

type PublicOperation = "help_read" | "help_write" | "intelligence" | "metrics" | "availability" | "shipping_preview" | "google_oauth";
const localWindows = new Map<string, { expiresAt: number; count: number }>();

export async function publicBudgetResponse(request: Request, operation: PublicOperation,
  environment: Readonly<Record<string, string | undefined>> = process.env): Promise<Response | null> {
  const production = environment.APP_ENV === "production" || environment.NODE_ENV === "production" || operation === "shipping_preview" || operation === "google_oauth";
  const key = environment.RATE_LIMIT_HMAC_KEY;
  const client = createServiceSupabaseClient();
  const failure = (status: number) => Response.json({ message: "Operação temporariamente indisponível. Aguarde e tente novamente." },
    { status, headers: { "cache-control": "private, no-store", "retry-after": "60" } });
  if (production && (!client || (key?.length ?? 0) < 32)) return failure(503);
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const identity = `public:${operation}:${address}`;
  const hash = key ? createHmac("sha256", key).update(identity).digest("hex")
    : createHash("sha256").update(`development:${identity}`).digest("hex");
  if (client) {
    try {
      // Reuse installed distributed budgets, with independent HMAC identities.
      const result = await client.rpc("consume_public_api_rate_limit", {
        p_operation: operation === "shipping_preview" ? "availability" : operation === "google_oauth" ? "help_write" : operation, p_key_hash: hash
      });
      if (!result.error && typeof result.data === "boolean") return result.data ? null : failure(429);
    } catch { /* Fail closed below; never disclose infrastructure errors. */ }
    if (production) return failure(503);
  }
  const now = Date.now();
  for (const [entry, window] of localWindows) if (window.expiresAt <= now) localWindows.delete(entry);
  if (localWindows.size >= 2_000 && !localWindows.has(hash)) return failure(429);
  const window = localWindows.get(hash) ?? { count: 0, expiresAt: now + 60_000 };
  localWindows.set(hash, window);
  return ++window.count <= 30 ? null : failure(429);
}
