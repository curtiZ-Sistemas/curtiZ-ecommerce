import type * as GoogleAuthModule from "./google-auth";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/auth/google/route";
import { readGoogleIntent } from "./google-auth";

type StoredCookie = {
  name: string;
  value: string;
  httpOnly?: boolean;
  secure?: boolean;
  path?: string;
  maxAge?: number;
};
const state = vi.hoisted(() => ({
  cookies: [] as StoredCookie[],
  ready: true,
  allowed: true,
  budget: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "curtiz.com.br" }),
  cookies: async () => ({
    getAll: () => state.cookies,
    get: (name: string) => state.cookies.find((cookie) => cookie.name === name),
    set: (cookie: StoredCookie) => {
      state.cookies = [...state.cookies.filter((item) => item.name !== cookie.name), cookie];
    }
  })
}));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => state.allowed }));
vi.mock("@/lib/private-request", () => import("./private-request"));
vi.mock("@/lib/public-request", () => ({ publicBudgetResponse: state.budget }));
vi.mock("@/lib/runtime-environment", () => ({ getStoreRuntimeEnvironment: () => process.env }));
vi.mock("@/lib/supabase/server", () => import("./supabase/server"));
vi.mock("@/lib/unknown-data", () => import("./unknown-data"));
vi.mock("@/lib/google-auth", async () => ({
  ...(await vi.importActual<typeof GoogleAuthModule>("./google-auth")),
  googleAuthReady: () => Promise.resolve(state.ready)
}));
vi.mock("./runtime-environment", () => ({ getStoreRuntimeEnvironment: () => process.env }));
const key = "test-only-signing-key-at-least-thirty-two-bytes";
beforeEach(() => {
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-public-key");
  vi.stubEnv("RATE_LIMIT_HMAC_KEY", key);
  vi.stubEnv("GOOGLE_AUTH_ENABLED", "true");
  vi.stubEnv("AUTH_COOKIE_DOMAINS", "curtiz.com.br");
  state.cookies = [];
  state.ready = true;
  state.allowed = true;
  state.budget.mockReset().mockResolvedValue(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? String(input) : input.url
      );
      if (url.pathname === "/rest/v1/published_legal_documents")
        return Response.json([{ version_id: "11111111-1111-4111-8111-111111111111" }]);
      throw new Error(`Unexpected test request ${url.pathname}`);
    })
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const request = (
  input: unknown = { terms: true, remember: true, marketing: false, next: "/checkout" }
) =>
  new NextRequest("https://curtiz.com.br/api/auth/google", {
    method: "POST",
    headers: { origin: "https://curtiz.com.br", "content-type": "application/json" },
    body: JSON.stringify(input)
  });
describe("server-side Google PKCE start", () => {
  it("uses the real SSR SDK with S256, protected verifier cookies and signed consent", async () => {
    const response = await POST(request());
    if (!(response instanceof NextResponse)) throw new Error("Expected NextResponse");
    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    const destination = new URL((payload as { redirectTo: string }).redirectTo);
    expect(destination.origin).toBe("https://project.supabase.co");
    expect(destination.pathname).toBe("/auth/v1/authorize");
    expect(destination.searchParams.get("provider")).toBe("google");
    expect(destination.searchParams.get("code_challenge_method")).toBe("s256");
    expect(destination.searchParams.get("code_challenge")).toBeTruthy();
    const callback = new URL(destination.searchParams.get("redirect_to") ?? "");
    expect(callback.origin).toBe("https://curtiz.com.br");
    expect(callback.pathname).toBe("/auth/callback");
    const intent = readGoogleIntent(
      response.cookies.get("curtiz-google-intent")?.value,
      callback.searchParams.get("google_nonce"),
      key
    );
    expect(intent).toMatchObject({
      remember: true,
      marketing: false,
      next: "/checkout",
      versions: ["11111111-1111-4111-8111-111111111111"]
    });
    expect(state.cookies.find((cookie) => cookie.name.includes("code-verifier"))).toMatchObject({
      httpOnly: true,
      secure: true
    });
    expect(response.cookies.get("curtiz-google-intent")?.httpOnly).toBe(true);
  });
  it.each([{ terms: false }, { terms: true, roles: ["admin"] }])(
    "rejects missing consent and unexpected privilege input %j",
    async (input) => {
      expect((await POST(request(input))).status).toBe(400);
      expect(state.cookies).toHaveLength(0);
    }
  );
  it("never starts for a disabled provider, foreign origin or exhausted distributed budget", async () => {
    state.ready = false;
    expect((await POST(request())).status).toBe(503);
    state.ready = true;
    state.allowed = false;
    expect((await POST(request())).status).toBe(403);
    state.allowed = true;
    state.budget.mockResolvedValue(Response.json({}, { status: 429 }));
    expect((await POST(request())).status).toBe(429);
    expect(state.cookies).toHaveLength(0);
  });
});
