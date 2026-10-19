import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
const state = vi.hoisted(() => ({
  conditions: [] as string[],
  signOut: vi.fn(),
  provider: "email"
}));
vi.mock("@/lib/google-auth", () => ({ GOOGLE_INTENT_COOKIE: "curtiz-google-intent" }));
vi.mock("@/lib/google-callback", () => ({ googleCallback: vi.fn() }));
vi.mock("@/lib/auth-routing", () => import("../../../lib/auth-routing"));
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
                user_metadata: { full_name: "Old OAuth Name", phone: "11999999999" }
              }
            },
            error: null
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
  state.signOut.mockReset().mockResolvedValue({ error: null });
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
