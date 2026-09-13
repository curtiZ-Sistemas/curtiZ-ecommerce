import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { PrivateRequestError, readPrivateJson, requirePrivateRateLimit } from "@/lib/private-request";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll") }).strict(),
  z.object({ action: z.literal("verify"), factorId: z.string().uuid(), code: z.string().regex(/^\d{6}$/u) }).strict(),
  z.object({ action: z.literal("cancel"), factorId: z.string().uuid() }).strict()
]);
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "cache-control": "private, no-store" }
});
const failure = (error: unknown) => json({ ok: false, message: "Não foi possível concluir a verificação. Tente novamente." },
  error instanceof PrivateRequestError ? error.status : 503);

async function session(request: Request) {
  if (!isAllowedRequestOrigin(request)) throw new PrivateRequestError(403);
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new PrivateRequestError(503);
  const user = await supabase.auth.getUser();
  if (user.error || !user.data.user) throw new PrivateRequestError(401);
  const profile = await supabase.from("profiles").select("status").eq("id", user.data.user.id).maybeSingle();
  if (profile.error) throw new PrivateRequestError(503);
  if (profile.data?.status !== "active") throw new PrivateRequestError(403);
  return supabase;
}

export async function GET(request: Request) {
  try {
    const supabase = await session(request);
    await requirePrivateRateLimit(supabase, "mfa_read");
    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) throw new PrivateRequestError(503);
    return json({ ok: true, factorId: factors.data.totp.find((factor) => factor.status === "verified")?.id ?? null });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const supabase = await session(request);
    const parsed = inputSchema.safeParse(await readPrivateJson(request, 1024));
    if (!parsed.success) throw new PrivateRequestError(400);
    const input = parsed.data;
    await requirePrivateRateLimit(supabase, input.action === "verify" ? "mfa_verify" : "mfa_enroll");
    const listed = await supabase.auth.mfa.listFactors();
    if (listed.error) throw new PrivateRequestError(503);
    if (input.action === "enroll") {
      const verified = listed.data.totp.find((factor) => factor.status === "verified");
      if (verified) return json({ ok: true, factorId: verified.id });
      // Only remove unfinished enrollments owned by this session. Verified factors are preserved.
      for (const factor of listed.data.all.filter((item) => item.factor_type === "totp" && item.status === "unverified")) {
        const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) throw new PrivateRequestError(503);
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Acesso interno curti Z" });
      if (enrolled.error) throw new PrivateRequestError(503);
      return json({ ok: true, factorId: enrolled.data.id, enrollment: {
        qrCode: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret
      } });
    }
    const factor = listed.data.all.find((item) => item.factor_type === "totp" && item.id === input.factorId);
    if (!factor) throw new PrivateRequestError(403);
    if (input.action === "cancel") {
      if (factor.status !== "unverified") throw new PrivateRequestError(403);
      const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (removed.error) throw new PrivateRequestError(503);
      return json({ ok: true });
    }
    const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: input.code });
    if (verified.error) throw new PrivateRequestError(400);
    // Refreshed session is persisted by the server cookie adapter, never returned as JSON.
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
