import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202609160001_auth_rate_limit_result_contract.sql",
  "utf8"
).toLowerCase();
const implementation = readFileSync("apps/store/src/lib/auth-rate-limit.ts", "utf8");
const readiness = readFileSync("scripts/validate-supabase-readiness.ts", "utf8");
const consumers = [
  "apps/store/src/app/api/auth/[mode]/route.ts",
  "apps/store/src/app/api/auth/password/route.ts",
  "apps/store/src/app/api/privacy/requests/route.ts",
  "apps/store/src/app/api/customer/delete-account/route.ts"
].map((path) => readFileSync(path, "utf8"));

describe("authentication rate limit result contract", () => {
  it("returns explicit allowed and blocked states from an atomic account budget", () => {
    expect(migration).toContain("returns jsonb");
    expect(migration).toContain("'status','allowed'");
    expect(migration).toContain("'status','blocked'");
    expect(migration).toContain("'retryafterseconds',retry_after");
    expect(migration).toContain("on conflict(scope,key_hash,window_started_at) do update");
  });

  it("keeps raw identifiers outside storage and browser callers outside the RPC", () => {
    expect(migration).toContain("p_key_hash !~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("from public,anon,authenticated");
    expect(migration).toContain("to service_role");
    expect(implementation).toContain("normalizeEmail(input.email)");
    expect(implementation).toContain('`${input.scope}:account:${normalizeEmail(input.email)}`');
    expect(implementation).not.toContain(":ip:");
    expect(readiness).toContain("auth_rate_limit_contract_version");
    expect(readiness).toContain("rateLimitVersion !== 2");
  });

  it("maps only real denials to 429 and infrastructure failures to 503", () => {
    for (const consumer of consumers) {
      expect(consumer).toContain('rateLimit.status === "blocked"');
      expect(consumer).toContain('rateLimit.status === "error"');
      expect(consumer).toMatch(/status:\s*429/u);
      expect(consumer).toMatch(/status:\s*503|reply\([^\n]+,\s*503\)/u);
    }
  });
});
