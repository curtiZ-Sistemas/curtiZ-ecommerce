import { logServerEvent } from "@curtiz/security";
import { safeDatabaseError } from "./checkout-diagnostics";

type HousekeepingEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

type HousekeepingResult = {
  ok: boolean;
  expired: number;
  attempts: number;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function runExpirationHousekeeping(
  environment: HousekeepingEnvironment,
  requestId: string,
  fetcher: typeof fetch = fetch
): Promise<HousekeepingResult> {
  let baseUrl: string | null = null;
  try {
    const url = new URL(environment.SUPABASE_URL?.trim() ?? "");
    if (url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash
      && !url.username && !url.password) baseUrl = url.origin;
  } catch { /* Invalid configuration is reported without exposing its value. */ }
  const secret = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!baseUrl || !secret) {
    logServerEvent("error", "checkout_housekeeping_configuration_missing", {
      requestId,
      code: "SUPABASE_SERVICE_CONFIGURATION_MISSING",
      message: null,
      details: null,
      hint: null
    });
    return { ok: false, expired: 0, attempts: 0 };
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetcher(`${baseUrl}/rest/v1/rpc/expire_stale_mercadopago_orders`, {
        method: "POST",
        headers: {
          apikey: secret,
          ...(!secret.startsWith("sb_secret_") ? { authorization: `Bearer ${secret}` } : {}),
          "content-type": "application/json",
          "x-client-info": "curtiz-checkout-housekeeping"
        },
        body: JSON.stringify({ p_limit: 50 }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000)
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && typeof payload === "number" && Number.isSafeInteger(payload) && payload >= 0) {
        logServerEvent("info", "checkout_housekeeping_completed", { requestId, expired: payload, attempts: attempt });
        return { ok: true, expired: payload, attempts: attempt };
      }

      const failure = safeDatabaseError(payload);
      const shouldRetry = response.status >= 500 && attempt === 1;
      logServerEvent("error", "checkout_housekeeping_rpc_failed", {
        requestId,
        code: "EXPIRATION_RPC_FAILED",
        status: response.status,
        attempt,
        message: failure.message,
        details: failure.details,
        hint: failure.hint,
        databaseCode: failure.code
      });
      if (!shouldRetry) return { ok: false, expired: 0, attempts: attempt };
    } catch {
      logServerEvent("error", "checkout_housekeeping_runtime_failure", {
        requestId,
        code: "EXPIRATION_RUNTIME_FAILURE",
        attempt,
        message: null,
        details: null,
        hint: null
      });
      if (attempt === 2) return { ok: false, expired: 0, attempts: attempt };
    }
    await wait(250);
  }

  return { ok: false, expired: 0, attempts: 2 };
}
