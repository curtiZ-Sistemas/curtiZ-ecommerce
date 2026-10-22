import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  conditions: [] as string[],
  signOut: vi.fn(),
  provider: "email",
  identities: [{ provider: "email" }] as Array<{ provider: string }>,
  token: "",
  exchangeError: null as { message: string } | null
}));
const jwt = (amr: Array<{ method: string; timestamp: number }>) => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ amr })}.signature`;
};
const nowSeconds = () => Math.floor(Date.now() / 1_000);
vi.mock("@/lib/google-auth", () => ({ GOOGLE_INTENT_COOKIE: "curtiz-google-intent" }));
vi.mock("@/lib/google-callback", () => ({ googleCallback: vi.fn() }));
vi.mock("@/lib/auth-routing", () => import("../../../lib/auth-routing"));
vi.mock("@/lib/password-recovery", () => import("../../../lib/password-recovery"));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({
      auth: {
        exchangeCodeForSession: () =>
          Promise.resolve({
            data: {
              user: {
                id: "user",
                app_metadata: { provider: state.provider },
                identities: state.identities,
                user_metadata: { full_name: "Old OAuth Name", phone: "11999999999" }
              },
              session: state.token ? { access_token: state.token } : null
            },
            error: state.exchangeError
          }),
        signOut: state.signOut
      },
      from: () => {
        const query = {
          update: () => query,
          select: () => query,
          eq: () => query,
          is: (column: string, value: null) => {
            state.conditions.push(`${column}:${String(value)}`);
            return Promise.resolve({ error: null });
          },
          maybeSingle: () => Promise.resolve({ data: { id: "existing-consent" }, error: null })
        };
        return query;
      }
    })
}));
beforeEach(() => {
  state.conditions = [];
  state.provider = "email";
  state.identities = [{ provider: "email" }];
  state.token = "";
  state.exchangeError = null;
  state.signOut.mockReset().mockResolvedValue({ error: null });
});
describe("password recovery callback", () => {
  const callback = (query = "code=recovery-code&next=/redefinir-senha") =>
    GET(new NextRequest(`https://curtiz.com.br/auth/callback?${query}`));
  it("opens the new-password page only for a session minted by a recovery link", async () => {
    state.token = jwt([{ method: "recovery", timestamp: nowSeconds() }]);
    const response = await callback();
    expect(response.headers.get("location")).toBe("https://curtiz.com.br/redefinir-senha");
    expect(state.signOut).not.toHaveBeenCalled();
    expect(state.conditions).toEqual([]);
  });
  it("does not accept an ordinary session on the recovery path", async () => {
    state.token = jwt([{ method: "password", timestamp: nowSeconds() }]);
    const response = await callback();
    expect(response.headers.get("location")).toBe("https://curtiz.com.br/esqueci-senha?reason=link_expired");
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("sends invalid, reused or missing codes to a new request, without echoing the code", async () => {
    state.exchangeError = { message: "otp_expired" };
    const reused = await callback();
    expect(reused.headers.get("location")).toBe("https://curtiz.com.br/esqueci-senha?reason=link_expired");
    expect((await callback("next=/redefinir-senha")).headers.get("location"))
      .toBe("https://curtiz.com.br/esqueci-senha?reason=link_expired");
    expect(reused.headers.get("location")).not.toContain("recovery-code");
  });
  it("never gives a Google-only account a password session", async () => {
    state.provider = "google";
    state.identities = [{ provider: "google" }];
    state.token = jwt([{ method: "recovery", timestamp: nowSeconds() }]);
    const response = await callback();
    expect(response.headers.get("location")).toBe("https://curtiz.com.br/login?reason=google_account");
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("keeps open redirects out of the recovery flow", async () => {
    state.token = jwt([{ method: "recovery", timestamp: nowSeconds() }]);
    const response = await callback("code=x&next=//attacker.invalid/redefinir-senha");
    expect(new URL(response.headers.get("location") ?? "").host).toBe("curtiz.com.br");
  });
});
describe("email callback preservation", () => {
  it("only fills NULL fields, preserving profile changes made after signup", async () => {
    const response = await GET(
      new NextRequest("https://curtiz.com.br/auth/callback?code=email-code")
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://curtiz.com.br/minha-conta");
    expect(state.conditions).toEqual(["full_name:null", "phone:null"]);
  });
  it("preserves email confirmation after an abandoned Google attempt", async () => {
    const response = await GET(
      new NextRequest("https://curtiz.com.br/auth/callback?code=email-code", {
        headers: { cookie: "curtiz-google-intent=abandoned-attempt" }
      })
    );
    expect(response.headers.get("location")).toBe("https://curtiz.com.br/minha-conta");
    expect(state.signOut).not.toHaveBeenCalled();
  });
  it("does not let a Google code bypass the signed intent through the legacy callback", async () => {
    state.provider = "google";
    const response = await GET(
      new NextRequest("https://curtiz.com.br/auth/callback?code=google-code")
    );
    expect(response.headers.get("location")).toContain("google_oauth_error");
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(state.conditions).toEqual([]);
  });
});
