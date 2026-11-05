import { isIP } from "node:net";
import { logServerEvent } from "./index";

export type AccessLogEnvironment = {
  APPLICATION_ACCESS_LOG_ENABLED?: string;
  PRIVACY_RETENTION_ENABLED?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};
type Application = "store" | "panel";

// Capture before OpenNext can replace global fetch with its request-scoped implementation.
const nativeFetch = globalThis.fetch;

async function persist(
  environment: AccessLogEnvironment,
  operation: "record_application_access" | "purge_expired_application_access_logs",
  payload: Record<string, string | number>,
  fetcher: typeof fetch
): Promise<boolean> {
  let endpoint: string;
  const secret = environment.SUPABASE_SECRET_KEY?.trim() || environment.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  try {
    const origin = new URL(environment.SUPABASE_URL ?? "");
    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash || !secret) {
      throw new Error("configuration");
    }
    endpoint = `${origin.origin}/rest/v1/rpc/${operation}`;
  } catch {
    logServerEvent("error", "application_access_log_failed", { operation, reason: "configuration" });
    return false;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          apikey: secret,
          ...(!secret.startsWith("sb_secret_") ? { authorization: `Bearer ${secret}` } : {}),
          "content-type": "application/json",
          "x-client-info": "curtiz-access-retention"
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3_000),
        redirect: "manual"
      });
      await response.body?.cancel();
      if (response.ok) return true;
      if (response.status !== 429 && response.status < 500) break;
    } catch {
      // Reuse the same record ID after ambiguous transport failures.
    }
  }
  logServerEvent("error", "application_access_log_failed", { operation, reason: "transport_or_response" });
  return false;
}

export async function recordApplicationAccess(
  request: Request,
  environment: AccessLogEnvironment,
  application: Application,
  fetcher: typeof fetch = nativeFetch
): Promise<boolean> {
  if (environment.APPLICATION_ACCESS_LOG_ENABLED !== "true") return false;
  // Cloudflare overwrites this header at its edge. Never accept client-supplied X-Forwarded-For.
  const ip = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (!isIP(ip)) {
    logServerEvent("warn", "application_access_log_failed", { application, reason: "missing_or_invalid_platform_ip" });
    return false;
  }
  return persist(environment, "record_application_access", {
    p_record_id: crypto.randomUUID(),
    p_application: application,
    p_ip_address: ip,
    p_occurred_at: new Date().toISOString()
  }, fetcher);
}

export async function purgeApplicationAccessLogs(
  environment: AccessLogEnvironment,
  fetcher: typeof fetch = nativeFetch
): Promise<boolean> {
  // Keep expiring existing records even if collection is switched off.
  if (environment.PRIVACY_RETENTION_ENABLED !== "true") return false;
  return persist(environment, "purge_expired_application_access_logs", { p_batch_size: 5_000 }, fetcher);
}
