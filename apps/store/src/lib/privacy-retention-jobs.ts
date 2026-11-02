import "server-only";
import { logServerEvent } from "@curtiz/security";

type RetentionEnvironment = {
  PRIVACY_RETENTION_ENABLED?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

type RetentionCounts = { events: number; profiles: number; rateBuckets: number };
type RetentionResult = RetentionCounts & { enabled: boolean; ok: boolean };
const empty: RetentionCounts = { events: 0, profiles: 0, rateBuckets: 0 };

export async function runPrivacyRetentionJobs(
  environment: RetentionEnvironment,
  executionId: string,
  fetcher: typeof fetch = fetch
): Promise<RetentionResult> {
  if (environment.PRIVACY_RETENTION_ENABLED !== "true") {
    return { enabled: false, ok: true, ...empty };
  }
  const failed = (reason: "configuration" | "response" | "transport") => {
    logServerEvent("error", "privacy_retention_failed", { executionId, reason });
    return { enabled: true, ok: false, ...empty };
  };
  const secret = environment.SUPABASE_SECRET_KEY?.trim() || environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  let origin: string;
  try {
    const url = new URL(environment.SUPABASE_URL?.trim() ?? "");
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      return failed("configuration");
    }
    origin = url.origin;
  } catch { return failed("configuration"); }
  if (!secret) return failed("configuration");

  try {
    const response = await fetcher(`${origin}/rest/v1/rpc/purge_expired_intelligence_data`, {
      method: "POST",
      headers: {
        apikey: secret,
        ...(!secret.startsWith("sb_secret_") ? { authorization: `Bearer ${secret}` } : {}),
        "content-type": "application/json",
        "x-client-info": "curtiz-privacy-retention"
      },
      body: JSON.stringify({ p_batch_size: 500 }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error"
    });
    if (!response.ok) { await response.body?.cancel(); return failed("response"); }
    const reader = response.body?.getReader();
    if (!reader) return failed("response");
    let bytes = 0;
    let text = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 4096) { await reader.cancel(); return failed("response"); }
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally { reader.releaseLock(); }
    const payload: unknown = JSON.parse(text + decoder.decode());
    if (!payload || typeof payload !== "object") return failed("response");
    const counts = payload as Record<string, unknown>;
    const validCount = (value: unknown): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 500;
    if (!validCount(counts.events) || !validCount(counts.profiles) || !validCount(counts.rateBuckets)) {
      return failed("response");
    }
    const result = { events: counts.events, profiles: counts.profiles, rateBuckets: counts.rateBuckets };
    logServerEvent("info", "privacy_retention_completed", { executionId, ...result });
    return { enabled: true, ok: true, ...result };
  } catch { return failed("transport"); }
}
