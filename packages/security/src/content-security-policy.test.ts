import { describe, expect, it } from "vitest";
import { buildNonceContentSecurityPolicy } from "./content-security-policy";

describe("nonce content security policy", () => {
  it("allows nonce scripts without unsafe inline scripts", () => {
    const policy = buildNonceContentSecurityPolicy({
      nonce: "0123456789abcdef0123456789abcdef",
      scriptSources: ["https://challenges.cloudflare.com"],
      connectSources: ["https://*.supabase.co"]
    });
    const scriptDirective = policy.split("; ").find((part) => part.startsWith("script-src"));
    expect(scriptDirective).toContain("'nonce-0123456789abcdef0123456789abcdef'");
    expect(scriptDirective).toContain("'strict-dynamic'");
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
  });

  it("rejects attacker-controlled nonce syntax", () => {
    expect(() => buildNonceContentSecurityPolicy({ nonce: "bad'; script-src *" })).toThrow(
      "Invalid CSP nonce"
    );
  });
});
