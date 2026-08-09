import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608080011_auth_rate_limit_recovery.sql",
  "utf8"
).toLowerCase();
const authRoute = readFileSync("apps/store/src/app/api/auth/[mode]/route.ts", "utf8");

describe("authentication rate limit recovery", () => {
  it("accepts password recovery without weakening the other scopes", () => {
    expect(migration).toContain("scope in ('login', 'signup', 'password_reset')");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
  });

  it("keeps login responses uniform and rate limiting mandatory in production", () => {
    expect(authRoute).not.toContain("findAccountByEmail");
    expect(authRoute).not.toContain("user_not_found");
    expect(authRoute).toContain('process.env.APP_ENV === "production"');
    expect(authRoute).toContain('message: "E-mail ou senha inválidos."');
  });
});
