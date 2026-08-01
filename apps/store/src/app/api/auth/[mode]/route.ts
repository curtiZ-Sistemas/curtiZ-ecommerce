import {
  DEMO_SESSION_COOKIE,
  REFERRAL_ATTRIBUTION_COOKIE,
  authenticateDemoAccount,
  createDemoSession,
  demoDestination,
  isLocalDemoRequest,
  safeInternalPath,
  sharedCookieOptions,
  verifyReferralAttribution,
  verifyDemoSession
} from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { readQueryResult } from "@/lib/unknown-data";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(256),
  remember: z.string().optional(),
  next: z.string().max(300).optional(),
  turnstileToken: z.string().max(4_096).optional()
});

const signupSchema = loginSchema
  .omit({ remember: true, next: true })
  .extend({
    name: z.string().trim().min(3).max(120),
    confirmPassword: z.string(),
    phone: z.string().trim().max(20).optional(),
    terms: z.literal("on"),
    marketing: z.string().optional()
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"]
  });

const roleDestinations: Record<string, string> = {
  customer: "/minha-conta",
  representative: "/representante",
  operational: "/operacional",
  admin: "/administracao",
  manager: "/gerencia",
  technical: "/tecnico"
};
const internalRolePriority = ["admin", "manager", "technical", "operational"] as const;

const profileSchema = z.object({ status: z.string() }).nullable();
const roleSchema = z.object({ role: z.string() }).nullable();

export async function GET(request: NextRequest, { params }: { params: Promise<{ mode: string }> }) {
  if ((await params).mode !== "session") {
    return NextResponse.json({ message: "Operação inválida." }, { status: 404 });
  }

  const demoSession = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demoSession) {
    return NextResponse.json(
      { authenticated: true, fullName: demoSession.fullName, roles: demoSession.roles },
      { headers: { "cache-control": "no-store" } }
    );
  }

  const supabase = await createServerSupabaseClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const metadataName: unknown = data.user.user_metadata.full_name;
      const fullName = typeof metadataName === "string" ? metadataName : "Cliente Curtiz";
      return NextResponse.json(
        { authenticated: true, fullName },
        { headers: { "cache-control": "no-store" } }
      );
    }
  }

  return NextResponse.json({ authenticated: false }, { headers: { "cache-control": "no-store" } });
}

function panelBaseUrl(request: Request) {
  const requestUrl = new URL(request.url);
  if (["localhost", "127.0.0.1", "::1"].includes(requestUrl.hostname)) {
    return `${requestUrl.protocol}//${requestUrl.hostname}:3001`;
  }
  return process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001";
}

function demoLoginResponse(
  request: Request,
  login: z.infer<typeof loginSchema>
): NextResponse | null {
  if (!isLocalDemoRequest(request)) return null;

  const account = authenticateDemoAccount(login.email, login.password);
  if (!account) {
    return NextResponse.json(
      { message: "E-mail ou senha inválidos." },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const session = createDemoSession(account, login.remember === "on");
  if (!session) {
    return NextResponse.json(
      { message: "O acesso demo local não está configurado corretamente." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const destination = demoDestination(account.role);
  const redirectTo =
    account.role === "customer" || account.role === "representative"
      ? safeInternalPath(login.next, destination)
      : new URL(destination, panelBaseUrl(request)).toString();
  const response = NextResponse.json(
    { message: "Acesso confirmado. Redirecionando…", redirectTo },
    { headers: { "cache-control": "no-store" } }
  );
  response.cookies.set(DEMO_SESSION_COOKIE, session.value, {
    ...sharedCookieOptions(
      {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: new URL(request.url).protocol === "https:",
        path: "/",
        ...(session.maxAge ? { maxAge: session.maxAge } : {})
      },
      new URL(request.url).hostname
    )
  });
  return response;
}

function isAllowedRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const configuredOrigins = new Set([
    process.env.NEXT_PUBLIC_STORE_URL,
    process.env.NEXT_PUBLIC_PANEL_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001"
  ]);
  if (configuredOrigins.has(origin)) return true;
  if (process.env.DEMO_MODE !== "true") return false;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    return (
      requestUrl.hostname === originUrl.hostname &&
      (originUrl.port === "3000" || originUrl.port === "3001")
    );
  } catch {
    return false;
  }
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !isAllowedRequest(request)) return { "cache-control": "no-store" };
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    vary: "Origin"
  };
}

export function OPTIONS(request: Request) {
  if (!isAllowedRequest(request)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ mode: string }> }) {
  if (!isAllowedRequest(request)) {
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403 });
  }

  const mode = (await params).mode;
  if (mode !== "login" && mode !== "signup" && mode !== "logout") {
    return NextResponse.json({ message: "Operação inválida." }, { status: 404 });
  }

  if (mode === "logout") {
    const supabase =
      process.env.DEMO_MODE === "true" ? null : await createServerSupabaseClient();
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) {
        return NextResponse.json(
          { message: "Não foi possível encerrar a sessão. Tente novamente." },
          { status: 503, headers: corsHeaders(request) }
        );
      }
    }
    const response = NextResponse.json(
      { message: "Sessão encerrada.", redirectTo: "/login" },
      { headers: corsHeaders(request) }
    );
    response.cookies.set(DEMO_SESSION_COOKIE, "", {
      ...sharedCookieOptions(
        {
          httpOnly: true,
          sameSite: "lax" as const,
          secure: new URL(request.url).protocol === "https:",
          path: "/",
          maxAge: 0
        },
        new URL(request.url).hostname
      )
    });
    return response;
  }

  const payload: unknown = await request.json();
  const parsed = (mode === "signup" ? signupSchema : loginSchema).safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: "Revise os dados informados." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const authInput = parsed.data as z.infer<typeof loginSchema>;
  if (
    !(await enforceAuthRateLimit({
      request,
      email: authInput.email,
      scope: mode,
      supabase
    }))
  ) {
    return NextResponse.json(
      { message: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." },
      { status: 429, headers: { ...corsHeaders(request), "retry-after": "900" } }
    );
  }
  if (!(await verifyTurnstile(request, authInput.turnstileToken))) {
    return NextResponse.json(
      { message: "Não foi possível confirmar a verificação de segurança." },
      { status: 403, headers: corsHeaders(request) }
    );
  }
  if (!supabase) {
    if (mode === "login") {
      const demoResponse = demoLoginResponse(request, parsed.data);
      if (demoResponse) return demoResponse;
    }

    return NextResponse.json(
      {
        message:
          process.env.NODE_ENV === "production"
            ? "O acesso está temporariamente indisponível."
            : "Supabase não configurado: o formulário foi validado, mas nenhuma sessão foi criada."
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  if (mode === "signup") {
    const signup = parsed.data as z.infer<typeof signupSchema>;
    const { error } = await supabase.auth.signUp({
      email: signup.email,
      password: signup.password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000"}/minha-conta`,
        data: {
          full_name: signup.name,
          phone: signup.phone || null,
          marketing_consent: signup.marketing === "on"
        }
      }
    });

    if (error) {
      return NextResponse.json(
        { message: "Não foi possível concluir o cadastro. Revise os dados ou tente novamente." },
        { status: 400, headers: { "cache-control": "no-store" } }
      );
    }

    return NextResponse.json(
      {
        message: "Cadastro recebido. Confira seu e-mail para confirmar a conta.",
        redirectTo: "/login"
      },
      { status: 201, headers: { "cache-control": "no-store" } }
    );
  }

  const login = parsed.data as z.infer<typeof loginSchema>;
  const { data, error } = await supabase.auth.signInWithPassword({
    email: login.email,
    password: login.password
  });

  if (error || !data.user) {
    return NextResponse.json(
      { message: "E-mail ou senha inválidos." },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  let referralClaimed = false;
  const referral = verifyReferralAttribution(
    request.cookies.get(REFERRAL_ATTRIBUTION_COOKIE)?.value,
    process.env.AUDIT_HASH_KEY ?? ""
  );
  if (referral) {
    const referralResult: unknown = await supabase.rpc("claim_referral_attribution", {
      p_code: referral.code
    });
    referralClaimed = !readQueryResult(referralResult).error;
  }

  const [profileResult, roleResult] = await Promise.all([
    supabase.from("profiles").select("status").eq("id", data.user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", data.user.id)
  ]);
  const rawProfile: unknown = profileResult.data;
  const rawRoles: unknown = roleResult.data;
  const profile = profileSchema.safeParse(rawProfile).data ?? null;
  const assignedRoles = z.array(roleSchema.unwrap()).safeParse(rawRoles).data ?? [];

  if (profile?.status && profile.status !== "active") {
    await supabase.auth.signOut();
    return NextResponse.json(
      { message: "Este acesso está indisponível. Entre em contato com o suporte." },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }

  const roles = assignedRoles.map((item) => item.role);
  const internalRole = internalRolePriority.find((item) => roles.includes(item));
  const role = internalRole ?? (roles.includes("representative") ? "representative" : "customer");
  const destination = roleDestinations[role] ?? "/minha-conta";
  const panelUrl = panelBaseUrl(request);
  let redirectTo =
    role === "customer" || role === "representative"
      ? safeInternalPath(login.next, safeInternalPath(destination, "/minha-conta"))
      : new URL(destination, panelUrl).toString();

  if (internalRole && process.env.REQUIRE_INTERNAL_MFA === "true") {
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) {
      await supabase.auth.signOut();
      return NextResponse.json(
        { message: "Não foi possível verificar a segurança desta conta." },
        { status: 503, headers: { "cache-control": "no-store" } }
      );
    }
    if (assurance.data.currentLevel !== "aal2") {
      redirectTo = `/mfa?next=${encodeURIComponent(redirectTo)}`;
    }
  }

  const response = NextResponse.json(
    { message: "Acesso confirmado. Redirecionando…", redirectTo },
    { headers: { "cache-control": "no-store" } }
  );
  if (referralClaimed) {
    response.cookies.set(REFERRAL_ATTRIBUTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 0
    });
  }
  return response;
}
