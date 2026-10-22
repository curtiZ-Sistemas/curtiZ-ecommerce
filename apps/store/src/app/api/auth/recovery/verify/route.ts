import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { PrivateRequestError, readPrivateJson } from "@/lib/private-request";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { enforceRecoveryVerificationRateLimit } from "@/lib/auth-rate-limit";
import { hasPasswordIdentity } from "@/lib/password-recovery";
import { issueRecoveryProof, RECOVERY_PROOF_COOKIE, recoveryProofCookieOptions } from "@/lib/recovery-proof";

const schema = z.object({ tokenHash: z.string().regex(/^[a-zA-Z0-9_-]{32,256}$/u) }).strict();

export async function POST(request: NextRequest) {
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
  const fail = (status: number) => NextResponse.json(
    { message: "Não foi possível validar este link. Solicite um novo para continuar." }, { status, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin || !isAllowedRequestOrigin(request)) return fail(403);
  let body: unknown;
  try { body = await readPrivateJson(request, 1024); }
  catch (error) { return fail(error instanceof PrivateRequestError ? error.status : 400); }
  const input = schema.safeParse(body);
  if (!input.success) return fail(400);
  const key = process.env.RATE_LIMIT_HMAC_KEY ?? "";
  if (key.length < 32) return fail(503);
  const client = await createServerSupabaseClient();
  if (!client) return fail(503);
  const budget = await enforceRecoveryVerificationRateLimit({ request, supabase: createServiceSupabaseClient() });
  if (budget.status === "error") return fail(503);
  if (budget.status === "blocked") return NextResponse.json({ message: "Aguarde antes de tentar novamente." },
    { status: 429, headers: { ...headers, "retry-after": String(budget.retryAfterSeconds) } });
  // The provider alone verifies and consumes the recovery token. Never log its request or response.
  const verified = await client.auth.verifyOtp({ type: "recovery", token_hash: input.data.tokenHash }).catch(() => null);
  if (!verified || verified.error || !verified.data.user || !verified.data.session) return fail(422);
  const { user, session } = verified.data;
  const rejectSession = async () => { await client.auth.signOut({ scope: "local" }).catch(() => undefined); };
  if (!hasPasswordIdentity(user)) {
    await rejectSession();
    return NextResponse.json({ redirectTo: "/login?reason=google_account" }, { status: 403, headers });
  }
  const profile = await client.from("profiles").select("status").eq("id", user.id).maybeSingle();
  const proof = issueRecoveryProof(session.access_token, user.id, user.updated_at ?? "", key);
  if (profile.error || profile.data?.status !== "active" || !proof) {
    await rejectSession();
    return fail(403);
  }
  // verifyOtp issues an OTP AMR, so bind the recovery-only proof to this exact verified session.
  const response = NextResponse.json({ ok: true }, { headers });
  response.cookies.set(RECOVERY_PROOF_COOKIE, proof, recoveryProofCookieOptions());
  return response;
}
