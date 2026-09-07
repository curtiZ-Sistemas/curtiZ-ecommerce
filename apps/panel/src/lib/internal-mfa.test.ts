import { afterEach, describe, expect, it, vi } from "vitest";
import { hasRequiredInternalMfa } from "./internal-mfa";

afterEach(() => vi.unstubAllEnvs());

describe("exigência de MFA interno", () => {
  it.each([undefined, "false"])("preserva configuração desabilitada (%s)", async (setting) => {
    vi.stubEnv("REQUIRE_INTERNAL_MFA", setting);
    const read = vi.fn();
    expect(await hasRequiredInternalMfa({ auth: { mfa: { getAuthenticatorAssuranceLevel: read } } })).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ["aal1", null, false],
    [null, null, false],
    ["aal2", null, true],
    ["aal2", { message: "unavailable" }, false]
  ])("valida nível %s e falha %j", async (level, error, expected) => {
    vi.stubEnv("REQUIRE_INTERNAL_MFA", "true");
    const read = vi.fn().mockResolvedValue({ data: { currentLevel: level }, error });
    expect(await hasRequiredInternalMfa({ auth: { mfa: { getAuthenticatorAssuranceLevel: read } } })).toBe(expected);
  });

  it("nega acesso se o provedor lança erro", async () => {
    vi.stubEnv("REQUIRE_INTERNAL_MFA", "true");
    const read = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await hasRequiredInternalMfa({ auth: { mfa: { getAuthenticatorAssuranceLevel: read } } })).toBe(false);
  });
});
