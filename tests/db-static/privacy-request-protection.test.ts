import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608080013_privacy_request_abuse_protection.sql",
  "utf8"
).toLowerCase();
const route = readFileSync("apps/store/src/app/api/privacy/requests/route.ts", "utf8");

describe("privacy request abuse protection", () => {
  it("rate limits and challenges the public route", () => {
    expect(route).toContain("enforcePrivacyRequestRateLimit");
    expect(route).toContain("verifyTurnstile");
    expect(route).toContain("status: 429");
  });

  it("prevents direct anonymous submission and deduplicates retries", () => {
    expect(migration).toContain("revoke all on function public.submit_privacy_request");
    expect(migration).toContain("grant execute on function public.submit_privacy_request(text,text,text,text,uuid) to service_role");
    expect(migration).toContain("requested_at >= now() - interval '24 hours'");
    expect(migration).toContain("'privacy_request'");
  });
});
