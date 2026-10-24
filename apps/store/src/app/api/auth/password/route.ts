import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePublicAppUrls } from "@curtiz/config";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";
import { corsHeadersFor, isAllowedRequestOrigin } from "@/lib/http-origin";
import { RECOVERY_PATH, classifyResetError, verifyRecoverySession } from "@/lib/password-recovery";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { PrivateRequestError, readPrivateJson } from "@/lib/private-request";
import { RECOVERY_PROOF_COOKIE, recoveryProofCookieOptions } from "@/lib/recovery-proof";

const requestSchema = z.object({
  action: z.literal("request"),
  email: z.string().trim().email().max(120),
  turnstileToken: z.string().max(4096).optional()
});
const updateSchema = z
  .object({
    action: z.literal("update"),
    password: z.string().min(8).max(256),
    confirmPassword: z.string().max(256)
  })
  .refine((input) => input.password === input.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não coincidem."
  });
const schema = z.discriminatedUnion("action", [requestSchema, updateSchema]);

export async function POST(request: NextRequest) {
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", ...corsHeadersFor(request) };
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ message: "Origem não autorizada." }, { status: 403, headers });
  }
  let body: unknown;
  try { body = await readPrivateJson(request, 8 * 1024); }
  catch (error) { return NextResponse.json({ message: "Revise os dados informados." },
    { status: error instanceof PrivateRequestError ? error.status : 400, headers }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const invalidEmail = parsed.error.issues.some((issue) => issue.path[0] === "email");
    return NextResponse.json({ message: invalidEmail ? "Informe um e-mail válido." : "Revise os dados informados." }, { status: 400, headers });
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { message: "A recuperação de acesso está temporariamente indisponível." },
      { status: 503, headers }
    );
  }
  if (parsed.data.action === "request") {
    // Verify the human check first so automated callers cannot spend a victim's hourly budget.
    if (!(await verifyTurnstile(request, parsed.data.turnstileToken, "password_recovery"))) {
      return NextResponse.json(
        { message: "Não foi possível confirmar a verificação de segurança." },
        { status: 403, headers }
      );
    }
    const rateLimit = await enforceAuthRateLimit({
      request,
      email: parsed.data.email,
      scope: "password_reset",
      supabase: createServiceSupabaseClient()
    });
    if (rateLimit.status === "blocked") {
      return NextResponse.json(
        { message: "Aguarde antes de solicitar outro link." },
        { status: 429, headers: { ...headers, "retry-after": String(rateLimit.retryAfterSeconds) } }
      );
    }
    if (rateLimit.status === "error") {
      return NextResponse.json(
        { message: "A proteção da recuperação está temporariamente indisponível." },
        { status: 503, headers }
      );
    }
    const baseUrl = resolvePublicAppUrls(request.url).storeUrl;
    const result = await supabase.auth
      .resetPasswordForEmail(parsed.data.email, { redirectTo: `${baseUrl}/auth/callback?next=${RECOVERY_PATH}` })
      .then((sent) => classifyResetError(sent.error))
      .catch(() => ({ outcome: "unavailable" as const, category: "provider_unreachable", status: null }));
    if (result.category !== "sent") {
      // Never log the address, the provider code or its message.
      console.error({ event: "password_reset_provider_response", category: result.category, status: result.status });
    }
    if (result.outcome === "unavailable") {
      return NextResponse.json(
        { message: "Não foi possível processar sua solicitação agora. Tente novamente mais tarde." },
        { status: 503, headers }
      );
    }
    return NextResponse.json(
      { message: "Solicitação recebida. Confira seu e-mail e a pasta de spam para continuar.", redirectTo: "/login?recovery=requested" },
      { headers }
    );
  }

  const recovery = await verifyRecoverySession(supabase, {
    value: request.cookies.get(RECOVERY_PROOF_COOKIE)?.value, key: process.env.RATE_LIMIT_HMAC_KEY ?? ""
  });
  if (recovery.status === "no_password_identity") {
    return NextResponse.json(
      { message: "Esta conta acessa a curti Z com o Google. Use o botão Entrar com Google." },
      { status: 403, headers }
    );
  }
  if (recovery.status !== "ok") {
    return NextResponse.json(
      { message: "Este link expirou ou não é válido. Solicite uma nova recuperação de acesso." },
      { status: recovery.status === "unauthenticated" || recovery.status === "expired" ? 401 : 403, headers }
    );
  }
  const updated = await supabase.auth.updateUser({ password: parsed.data.password });
  if (updated.error) {
    const code = (updated.error as { code?: string }).code;
    if (code === "insufficient_aal") {
      const next = encodeURIComponent(`${resolvePublicAppUrls(request.url).storeUrl}${RECOVERY_PATH}`);
      return NextResponse.json(
        { message: "Confirme sua identidade com o código de verificação para continuar.", redirectTo: `/mfa?next=${next}` },
        { status: 403, headers }
      );
    }
    if (code === "same_password" || code === "weak_password") {
      return NextResponse.json(
        { message: code === "same_password"
          ? "Escolha uma senha diferente da atual."
          : "Escolha uma senha mais forte, com letras, números e símbolos." },
        { status: 422, headers }
      );
    }
    return NextResponse.json(
      { message: "Não foi possível atualizar a senha. Solicite um novo link." },
      { status: 422, headers }
    );
  }
  // Single use: end the recovery session and every other session of this account.
  const signedOut = await supabase.auth.signOut({ scope: "global" }).catch(() => ({ error: true }));
  if (signedOut.error) console.error({ event: "password_reset_signout_failed" });
  const response = NextResponse.json(
    { message: "Senha atualizada. Entre com a nova senha.", redirectTo: "/login?senha=atualizada" },
    { headers }
  );
  response.cookies.set(RECOVERY_PROOF_COOKIE, "", { ...recoveryProofCookieOptions(), maxAge: 0 });
  return response;
}
