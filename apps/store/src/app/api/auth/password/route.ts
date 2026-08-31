import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePublicAppUrls } from "@curtiz/config";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";
import { corsHeadersFor, isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";

const requestSchema = z.object({
  action: z.literal("request"),
  email: z.string().trim().email().max(120),
  turnstileToken: z.string().max(4096).optional()
});
const updateSchema = z
  .object({
    action: z.literal("update"),
    password: z.string().min(10).max(256),
    confirmPassword: z.string().max(256)
  })
  .refine((input) => input.password === input.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não coincidem."
  });
const schema = z.discriminatedUnion("action", [requestSchema, updateSchema]);

export async function POST(request: NextRequest) {
  const headers = { "cache-control": "private, no-store", ...corsHeadersFor(request) };
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ message: "Origem não autorizada." }, { status: 403, headers });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Revise os dados informados." }, { status: 400, headers });
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { message: "A recuperação de acesso está temporariamente indisponível." },
      { status: 503, headers }
    );
  }
  if (parsed.data.action === "request") {
    if (
      !(await enforceAuthRateLimit({
        request,
        email: parsed.data.email,
        scope: "password_reset",
        supabase
      }))
    ) {
      return NextResponse.json(
        { message: "Aguarde antes de solicitar outro link." },
        { status: 429, headers: { ...headers, "retry-after": "3600" } }
      );
    }
    if (!(await verifyTurnstile(request, parsed.data.turnstileToken))) {
      return NextResponse.json(
        { message: "Não foi possível confirmar a verificação de segurança." },
        { status: 403, headers }
      );
    }
    const baseUrl = resolvePublicAppUrls(request.url).storeUrl;
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${baseUrl}/auth/callback?next=/redefinir-senha`
    });
    return NextResponse.json(
      { message: "Se a conta existir, enviaremos as instruções para o e-mail informado." },
      { headers }
    );
  }

  const userResult = await supabase.auth.getUser();
  if (!userResult.data.user) {
    return NextResponse.json(
      { message: "Este link expirou. Solicite uma nova recuperação de acesso." },
      { status: 401, headers }
    );
  }
  const updated = await supabase.auth.updateUser({ password: parsed.data.password });
  if (updated.error) {
    return NextResponse.json(
      { message: "Não foi possível atualizar a senha. Solicite um novo link." },
      { status: 422, headers }
    );
  }
  return NextResponse.json(
    { message: "Senha atualizada com segurança.", redirectTo: "/minha-conta" },
    { headers }
  );
}
