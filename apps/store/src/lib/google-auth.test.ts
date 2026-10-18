import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleIntent,
  readGoogleIntent,
  googleAuthReady,
  googleLoginDestination,
  recordGoogleConsents,
  type AuthClient
} from "./google-auth";
vi.mock("server-only", () => ({}));
vi.mock("./runtime-environment", () => ({ getStoreRuntimeEnvironment: () => ({}) }));
vi.mock("./supabase/server", () => ({}));
const key = "test-only-signing-key-at-least-thirty-two-bytes";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Google OAuth signed intent", () => {
  it("binds explicit consent, destination and persistence to an expiring nonce", () => {
    const { intent, token } = createGoogleIntent(
      { remember: true, marketing: false, next: "/checkout", versions: [] },
      key
    );
    expect(readGoogleIntent(token, intent.nonce, key)).toEqual(intent);
    expect(readGoogleIntent(token, "other", key)).toBeNull();
    expect(readGoogleIntent(token + "x", intent.nonce, key)).toBeNull();
    expect(readGoogleIntent(token, intent.nonce, key + "wrong")).toBeNull();
    expect(readGoogleIntent(undefined, intent.nonce, key)).toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(intent.expires + 1);
    expect(readGoogleIntent(token, intent.nonce, key)).toBeNull();
  });
  it("never activates without opt-in, provider readiness and a signing key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ external: { google: true } }));
    vi.stubGlobal("fetch", fetchMock);
    const values = {
      GOOGLE_AUTH_ENABLED: "true",
      RATE_LIMIT_HMAC_KEY: key,
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-public-key"
    };
    expect(await googleAuthReady({ ...values, GOOGLE_AUTH_ENABLED: "false" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await googleAuthReady(values)).toBe(true);
    fetchMock.mockResolvedValue(Response.json({ external: { google: false } }));
    expect(await googleAuthReady(values)).toBe(false);
    fetchMock.mockRejectedValue(new Error("unavailable"));
    expect(await googleAuthReady(values)).toBe(false);
    expect(await googleAuthReady({ ...values, RATE_LIMIT_HMAC_KEY: "" })).toBe(false);
  });
});

function database(roles: string[], status = "active") {
  const assurance = vi.fn(async () => ({ data: { currentLevel: "aal1" }, error: null }));
  const rpc = vi.fn(async () => ({ error: null }));
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === "profiles"
            ? { maybeSingle: async () => ({ data: { status }, error: null }) }
            : Promise.resolve({ data: roles.map((role) => ({ role })), error: null })
      })
    }),
    auth: { mfa: { getAuthenticatorAssuranceLevel: assurance } },
    rpc
  } as unknown as AuthClient;
  return { client, assurance, rpc };
}
describe("Google login authorization", () => {
  it.each([
    ["customer", "https://curtiz.com.br/minha-conta"],
    ["admin", "https://painel.curtiz.com.br/administracao"],
    ["operational", "https://painel.curtiz.com.br/operacional"]
  ])("uses the database role %s", async (role, expected) => {
    expect(
      await googleLoginDestination(
        database([role]).client,
        "user",
        undefined,
        "https://curtiz.com.br/login",
        {}
      )
    ).toBe(expected);
  });
  it("blocks missing roles, inactive profiles and untrusted redirects", async () => {
    await expect(
      googleLoginDestination(database([]).client, "user", undefined, "https://curtiz.com.br", {})
    ).rejects.toThrow();
    await expect(
      googleLoginDestination(
        database(["admin"], "blocked").client,
        "user",
        undefined,
        "https://curtiz.com.br",
        {}
      )
    ).rejects.toThrow();
    expect(
      await googleLoginDestination(
        database(["customer"]).client,
        "user",
        "/administracao",
        "https://curtiz.com.br",
        {}
      )
    ).toBe("https://curtiz.com.br/minha-conta");
    expect(
      await googleLoginDestination(
        database(["customer"]).client,
        "user",
        "https://evil.invalid",
        "https://curtiz.com.br",
        {}
      )
    ).toBe("https://curtiz.com.br/minha-conta");
  });
  it("requires internal MFA without granting privileges from Google metadata", async () => {
    const db = database(["admin"]);
    const destination = await googleLoginDestination(
      db.client,
      "user",
      undefined,
      "https://curtiz.com.br",
      { REQUIRE_INTERNAL_MFA: "true" }
    );
    expect(destination).toBe(
      "https://curtiz.com.br/mfa?next=https%3A%2F%2Fpainel.curtiz.com.br%2Fadministracao"
    );
    expect(db.assurance).toHaveBeenCalledOnce();
  });
  it("records explicit legal consent and only affirmative separate marketing consent", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const query = {
      select: () => query,
      eq: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
      insert
    };
    const rpc = vi.fn(async () => ({ error: null }));
    const client = { from: () => query, rpc } as unknown as AuthClient;
    const { intent } = createGoogleIntent({ remember: false, marketing: false, versions: [] }, key);
    await recordGoogleConsents(client, "user", intent);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      user_id: "user",
      consent_type: "terms_and_privacy",
      accepted: true,
      version: "legacy:2026-08"
    });
    insert.mockClear();
    await recordGoogleConsents(client, "user", { ...intent, marketing: true });
    expect(insert).toHaveBeenCalledTimes(2);
  });
});
