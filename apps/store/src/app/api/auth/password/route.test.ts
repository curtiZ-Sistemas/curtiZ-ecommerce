import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/http-origin", () => import("../../../../lib/http-origin"));
vi.mock("@/lib/private-request", () => import("../../../../lib/private-request"));
vi.mock("@/lib/auth-rate-limit", () => ({ enforceAuthRateLimit: vi.fn() }));
vi.mock("@/lib/password-recovery", () => ({ RECOVERY_PATH: "/redefinir-senha", classifyResetError: vi.fn(), verifyRecoverySession: vi.fn() }));
vi.mock("@/lib/recovery-proof", () => ({ RECOVERY_PROOF_COOKIE: "proof", recoveryProofCookieOptions: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => null, createServiceSupabaseClient: () => null }));

import { POST } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("password update length validation", () => {
  it.each([["SolMar9", 400], ["SolMar92", 503]] as const)("validates length before accessing Auth", async (password, expected) => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://curtiz.com.br");
    const response = await POST(new NextRequest("https://curtiz.com.br/api/auth/password", {
      method: "POST", headers: { origin: "https://curtiz.com.br", "content-type": "application/json" },
      body: JSON.stringify({ action: "update", password, confirmPassword: password })
    }));
    // Eight characters pass input validation but still require the Auth service.
    expect(response.status).toBe(expected);
  });
});
