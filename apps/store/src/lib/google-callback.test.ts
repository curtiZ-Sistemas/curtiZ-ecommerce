import type * as GoogleAuthModule from "./google-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createGoogleIntent } from "./google-auth";
import { googleCallback } from "./google-callback";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  destination: vi.fn(),
  consent: vi.fn(),
  exchange: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  clientOptions: vi.fn()
}));
const key = "test-only-signing-key-at-least-thirty-two-bytes";
vi.mock("./runtime-environment", () => ({
  getStoreRuntimeEnvironment: () => ({
    GOOGLE_AUTH_ENABLED: "true",
    RATE_LIMIT_HMAC_KEY: "test-only-signing-key-at-least-thirty-two-bytes"
  })
}));
vi.mock("./supabase/server", () => ({
  createServerSupabaseClient: (options: unknown) => {
    state.clientOptions(options);
    return Promise.resolve({
      auth: {
        getUser: state.getUser,
        exchangeCodeForSession: state.exchange,
        signOut: state.signOut
      }
    });
  }
}));
vi.mock("./google-auth", async (original) => ({
  ...(await original<typeof GoogleAuthModule>()),
  googleLoginDestination: state.destination,
  recordGoogleConsents: state.consent
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.destination.mockResolvedValue("https://curtiz.com.br/minha-conta");
  state.consent.mockResolvedValue(undefined);
  state.getUser.mockResolvedValue({ data: { user: null } });
  state.exchange.mockResolvedValue({
    data: { user: { id: "existing-user", identities: [{ provider: "google" }] } },
    error: null
  });
  state.signOut.mockResolvedValue({ error: null });
});
function request(
  options: {
    expired?: boolean;
    error?: boolean;
    token?: string;
    nonce?: string;
    code?: boolean;
  } = {}
) {
  const { intent, token } = createGoogleIntent(
    { remember: true, marketing: false, versions: [] },
    key
  );
  const url = new URL("https://curtiz.com.br/auth/callback");
  url.searchParams.set("google_nonce", options.nonce ?? intent.nonce);
  if (options.code !== false) url.searchParams.set("code", "one-use-code");
  if (options.error) url.searchParams.set("error", "access_denied");
  return new NextRequest(url, {
    headers: { cookie: `curtiz-google-intent=${options.token ?? token}` }
  });
}
describe("Google callback", () => {
  it.each([{ nonce: "wrong" }, { token: "tampered" }, { error: true }, { code: false }])(
    "rejects invalid, cancelled and missing codes before exchange %j",
    async (options) => {
      expect((await googleCallback(request(options))).headers.get("location")).toBe(
        "https://curtiz.com.br/login?reason=google_oauth_error"
      );
      expect(state.exchange).not.toHaveBeenCalled();
    }
  );
  it("completes a valid exchange, records consent and clears the one-use intent", async () => {
    const response = await googleCallback(request());
    expect(response.headers.get("location")).toBe("https://curtiz.com.br/minha-conta");
    expect(state.exchange).toHaveBeenCalledWith("one-use-code");
    expect(state.clientOptions).toHaveBeenCalledWith({ persistence: "persistent" });
    expect(state.consent).toHaveBeenCalledOnce();
    expect(response.cookies.get("curtiz-google-intent")?.value).toBe("");
    expect(response.cookies.get("curtiz-auth-persistence")?.value).toBe("persistent");
  });
  it("preserves a session already established in another tab", async () => {
    state.getUser.mockResolvedValue({ data: { user: { id: "already-signed-in" } } });
    await googleCallback(request());
    expect(state.exchange).not.toHaveBeenCalled();
    expect(state.signOut).not.toHaveBeenCalled();
  });
  it("handles expiration and refuses missing permissions or consent failure", async () => {
    state.exchange.mockResolvedValueOnce({
      error: { message: "private provider detail" },
      data: {}
    });
    const expired = await googleCallback(request());
    expect(expired.headers.get("location")).toContain("google_oauth_error");
    expect(expired.headers.get("location")).not.toContain("private");
    state.destination.mockRejectedValueOnce(new Error("blocked profile"));
    await googleCallback(request());
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    state.consent.mockRejectedValueOnce(new Error("consent database unavailable"));
    expect((await googleCallback(request())).headers.get("location")).toContain(
      "google_oauth_error"
    );
  });
});
