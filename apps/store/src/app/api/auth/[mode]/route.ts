import {
  DEMO_SESSION_COOKIE,
  AUTH_PERSISTENCE_COOKIE,
  REFERRAL_ATTRIBUTION_COOKIE,
  authenticateDemoAccount,
  createDemoSession,
  demoDestination,
  isLocalDemoRequest,
  safeInternalPath,
  readAuthPersistence,
  sharedCookieOptions,
  verifyReferralAttribution,
  verifyDemoSession
} from "@curtiz/security";
import { configuredPublicOrigins, resolvePublicAppUrls } from "@curtiz/config";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";
import {
  resolveLoginDestination,
  resolveLoginRole,
  resolvePostLoginDestination
} from "@/lib/auth-routing";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { readQueryResult } from "@/lib/unknown-data";
import { parseSignupInput, type NormalizedSignupInput } from "@/lib/signup-validation";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(120)
    .transform((value) => value.toLocaleLowerCase("pt-BR")),
  password: z.string().min(6).max(256),
  remember: z.string().optional(),
  next: z.string().max(300).optional(),
  turnstileToken: z.string().max(4_096).optional()
});

const resendSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(120)
    .transform((value) => value.toLocaleLowerCase("pt-BR")),
  next: z.string().max(300).optional()
});

const profileSchema = z.object({ status: z.string() }).nullable();
const roleSchema = z.object({ role: z.string() }).nullable();

function setPersistenceCookie(response: NextResponse, request: Request, persistent: boolean) {
  response.cookies.set(AUTH_PERSISTENCE_COOKIE, persistent ? "persistent" : "session", {
    ...sharedCookieOptions(
      {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: new URL(request.url).protocol === "https:",
        path: "/",
        ...(persistent ? { maxAge: 365 * 24 * 60 * 60 } : {})
      },
      new URL(request.url).hostname
    )
  });
}

type SupabaseAuthErrorDetails = {
  code: string;
  status: number;
  message: string;
};

function readSupabaseAuthError(error: unknown): SupabaseAuthErrorDetails {
  if (!error || typeof error !== "object") {
    return {
      code: "supabase_auth_unavailable",
      status: 503,
      message: "Supabase Auth não retornou um erro estruturado."
    };
  }

  const candidate = error as { code?: unknown; status?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code : "supabase_auth_unavailable",
    status: typeof candidate.status === "number" ? candidate.status : 503,
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : "Supabase Auth não retornou uma mensagem de erro."
  };
}

function logSupabaseAuthError(error: SupabaseAuthErrorDetails) {
  console.error("Supabase Auth login error", {
    code: error.code,
    status: error.status,
    message: error.message
  });
}

async function authErrorResponse(error: SupabaseAuthErrorDetails, request: Request) {
  const normalizedMessage = error.message.toLowerCase();
  const headers = corsHeaders(request);

  if (error.code === "email_not_confirmed") {
    return NextResponse.json(
      {
        code: error.code,
        message: "Confirme seu e-mail antes de acessar a conta."
      },
      { status: 403, headers }
    );
  }

  if (error.code === "over_request_rate_limit") {
    return NextResponse.json(
      {
        code: error.code,
        message: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."
      },
      { status: 429, headers: { ...headers, "retry-after": "900" } }
    );
  }

  if (error.code === "invalid_credentials") {
    return NextResponse.json(
      {
        code: error.code,
        message: "E-mail ou senha inválidos."
      },
      { status: 401, headers }
    );
  }

  const configurationError =
    error.code === "supabase_auth_unavailable" ||
    error.code === "unexpected_failure" ||
    normalizedMessage.includes("invalid api key") ||
    normalizedMessage.includes("api key") ||
    error.status >= 500;

  return NextResponse.json(
    {
      code: configurationError ? "supabase_configuration_error" : error.code,
      message: configurationError
        ? "O acesso está temporariamente indisponível por uma falha de configuração."
        : "Não foi possível acessar sua conta agora. Tente novamente."
    },
    { status: configurationError ? 503 : Math.max(400, error.status), headers }
  );
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ mode: string }> }) {
  if ((await params).mode !== "session") {
    return NextResponse.json({ message: "Operação inválida." }, { status: 404 });
  }

  const demoSession = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demoSession) {
    return NextResponse.json(
      {
        authenticated: true,
        fullName: demoSession.fullName,
        roles: demoSession.roles,
        persistent:
          readAuthPersistence(request.cookies.get(AUTH_PERSISTENCE_COOKIE)?.value) === "persistent"
      },
      { headers: { "cache-control": "no-store" } }
    );
  }

  const supabase = await createServerSupabaseClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const metadataName: unknown = data.user.user_metadata.full_name;
      const fullName = typeof metadataName === "string" ? metadataName : "Cliente z";
      return NextResponse.json(
        {
          authenticated: true,
          fullName,
          persistent:
            readAuthPersistence(request.cookies.get(AUTH_PERSISTENCE_COOKIE)?.value) ===
            "persistent"
        },
        { headers: { "cache-control": "no-store" } }
      );
    }
  }

  return NextResponse.json({ authenticated: false }, { headers: { "cache-control": "no-store" } });
}

function panelBaseUrl(request: Request): string {
  return resolvePublicAppUrls(request.url).panelUrl;
}

function customerDestination(value: string | undefined) {
  const destination = safeInternalPath(value, "/minha-conta?cadastro=sucesso");
  if (
    destination.startsWith("/login") ||
    destination.startsWith("/cadastro") ||
    destination.startsWith("/auth/")
  ) {
    return "/minha-conta?cadastro=sucesso";
  }
  return destination;
}

function confirmationRedirect(request: Request, next: string | undefined) {
  const callback = new URL("/auth/callback", resolvePublicAppUrls(request.url).storeUrl);
  callback.searchParams.set("next", customerDestination(next));
  return callback.toString();
}

function demoLoginResponse(
  request: Request,
  login: z.infer<typeof loginSchema>
): NextResponse | null {
  if (!login.email.endsWith("@curtiz.local") || !isLocalDemoRequest(request)) return null;

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
      { message: "O acesso local não está configurado corretamente." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const destination = demoDestination(account.role);
  const redirectTo =
    account.role === "customer" || account.role === "representative"
      ? resolvePostLoginDestination(safeInternalPath(login.next, destination))
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
  setPersistenceCookie(response, request, login.remember === "on");
  return response;
}

function isAllowedRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const requestOrigin = new URL(request.url).origin;
  const configuredOrigins = new Set([
    ...configuredPublicOrigins(),
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001"
  ]);
  if (origin === requestOrigin || configuredOrigins.has(origin)) return true;
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mode: string }> }
) {
  if (!isAllowedRequest(request)) {
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403 });
  }

  const mode = (await params).mode;
  if (mode !== "login" && mode !== "signup" && mode !== "resend" && mode !== "logout") {
    return NextResponse.json({ message: "Operação inválida." }, { status: 404 });
  }

  if (mode === "logout") {
    const signedDemoSession = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
    const supabase = signedDemoSession ? null : await createServerSupabaseClient();
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
    response.cookies.set(AUTH_PERSISTENCE_COOKIE, "", {
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Dados de acesso inválidos." },
      { status: 400, headers: corsHeaders(request) }
    );
  }
  const parsed =
    mode === "signup"
      ? parseSignupInput(payload)
      : mode === "resend"
        ? resendSchema.safeParse(payload)
        : loginSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Revise os dados informados.",
        issues: parsed.error.flatten().fieldErrors
      },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  const authInput = parsed.data as z.infer<typeof loginSchema>;
  const supabase = await createServerSupabaseClient({
    persistence: mode === "login" && authInput.remember === "on" ? "persistent" : "session"
  });

  const authRateLimitEnabled =
    process.env.APP_ENV === "production" ||
    process.env.AUTH_RATE_LIMIT_ENABLED?.trim().toLowerCase() === "true";

  if (
    authRateLimitEnabled &&
    !(await enforceAuthRateLimit({
      request,
      email: authInput.email,
      scope: mode === "resend" ? "signup" : mode,
      supabase
    }))
  ) {
    return NextResponse.json(
      {
        message: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."
      },
      {
        status: 429,
        headers: {
          ...corsHeaders(request),
          "retry-after": "900"
        }
      }
    );
  }
  if (
    mode !== "resend" &&
    !(await verifyTurnstile(
      request,
      "turnstileToken" in authInput ? authInput.turnstileToken : undefined
    ))
  ) {
    return NextResponse.json(
      { message: "Não foi possível confirmar a verificação de segurança." },
      { status: 403, headers: corsHeaders(request) }
    );
  }

  // Contas locais isoladas nunca interceptam credenciais reais do Supabase.
  if (mode === "login") {
    const demoResponse = demoLoginResponse(request, parsed.data as z.infer<typeof loginSchema>);
    if (demoResponse) return demoResponse;
  }

  if (!supabase) {
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

  if (mode === "resend") {
    const resend = parsed.data;
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: resend.email,
      options: { emailRedirectTo: confirmationRedirect(request, resend.next) }
    });
    if (error) {
      const details = readSupabaseAuthError(error);
      logSupabaseAuthError(details);
      if (details.code === "over_request_rate_limit") {
        return authErrorResponse(details, request);
      }
    }
    return NextResponse.json(
      {
        message:
          "Se o cadastro estiver aguardando confirmação, um novo e-mail será enviado em instantes."
      },
      { headers: corsHeaders(request) }
    );
  }

  if (mode === "signup") {
    const signup = parsed.data as NormalizedSignupInput;
    const { data, error } = await supabase.auth.signUp({
      email: signup.email,
      password: signup.password,
      options: {
        emailRedirectTo: confirmationRedirect(request, signup.next),
        data: {
          full_name: signup.name,
          phone: signup.phone,
          terms_accepted_at: new Date().toISOString(),
          marketing_consent: signup.marketing === "on"
        }
      }
    });

    if (error) {
      const details = readSupabaseAuthError(error);
      logSupabaseAuthError(details);
      return NextResponse.json(
        {
          code: details.code,
          message:
            "Não foi possível concluir o cadastro. Se você já possui conta, tente entrar ou recuperar a senha."
        },
        { status: details.status === 429 ? 429 : 400, headers: corsHeaders(request) }
      );
    }

    if (!data.session || !data.user) {
      return NextResponse.json(
        {
          code: "email_confirmation_required",
          message: "Cadastro recebido. Confirme seu e-mail para continuar."
        },
        { status: 202, headers: corsHeaders(request) }
      );
    }

    const legalVersions = await supabase
      .from("published_legal_documents")
      .select("version_id")
      .in("slug", ["termos-de-uso", "aviso-de-privacidade"]);
    const legalVersionIds =
      z
        .array(z.object({ version_id: z.string().uuid() }))
        .safeParse(legalVersions.data)
        .data?.map((item) => item.version_id) ?? [];
    const [profileUpdate, consentInsert] = await Promise.all([
      supabase
        .from("profiles")
        .update({ full_name: signup.name, phone: signup.phone })
        .eq("id", data.user.id),
      supabase.from("customer_consents").insert({
        user_id: data.user.id,
        consent_type: "terms_and_privacy",
        accepted: true,
        version: legalVersionIds.length ? `legal:${legalVersionIds.join(",")}` : "legacy:2026-08",
        user_agent_summary: request.headers.get("user-agent")?.slice(0, 180) ?? null
      })
    ]);
    const legalAcceptance = legalVersionIds.length
      ? await supabase.rpc("record_legal_acceptances", {
          p_context: "signup",
          p_version_ids: legalVersionIds
        })
      : { error: null };
    if (
      legalVersions.error ||
      profileUpdate.error ||
      consentInsert.error ||
      legalAcceptance.error
    ) {
      const details = readSupabaseAuthError(
        legalVersions.error ?? profileUpdate.error ?? consentInsert.error ?? legalAcceptance.error
      );
      logSupabaseAuthError(details);
      await supabase.auth.signOut();
      return NextResponse.json(
        {
          code: "signup_profile_unavailable",
          message:
            "A conta foi criada, mas não foi possível concluir seu perfil. Tente entrar novamente."
        },
        { status: 503, headers: corsHeaders(request) }
      );
    }

    const [profileResult, roleResult] = await Promise.all([
      supabase.from("profiles").select("status").eq("id", data.user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", data.user.id)
    ]);
    const signupRoles = z.array(roleSchema.unwrap()).safeParse(roleResult.data).data ?? [];
    if (
      profileResult.error ||
      roleResult.error ||
      profileResult.data?.status !== "active" ||
      !signupRoles.some((item) => item.role === "customer")
    ) {
      const details = readSupabaseAuthError(
        profileResult.error ??
          roleResult.error ?? {
            code: "signup_identity_incomplete",
            status: 503,
            message: "Perfil ou papel customer não foi criado pelo gatilho de identidade."
          }
      );
      logSupabaseAuthError(details);
      await supabase.auth.signOut();
      return NextResponse.json(
        {
          code: "signup_identity_incomplete",
          message:
            "A conta foi criada, mas não foi possível concluir seu perfil. Tente entrar novamente."
        },
        { status: 503, headers: corsHeaders(request) }
      );
    }

    return NextResponse.json(
      {
        code: "signup_complete",
        message: "Cadastro realizado com sucesso.",
        redirectTo: customerDestination(signup.next)
      },
      { status: 201, headers: corsHeaders(request) }
    );
  }

  const login = parsed.data as z.infer<typeof loginSchema>;
  let signInResult: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
  try {
    signInResult = await supabase.auth.signInWithPassword({
      email: login.email,
      password: login.password
    });
  } catch (error) {
    const details = readSupabaseAuthError(error);
    logSupabaseAuthError(details);
    return authErrorResponse(details, request);
  }

  const { data, error } = signInResult;
  if (error) {
    const details = readSupabaseAuthError(error);
    logSupabaseAuthError(details);
    return authErrorResponse(details, request);
  }
  if (!data.user) {
    const details: SupabaseAuthErrorDetails = {
      code: "supabase_auth_unavailable",
      status: 503,
      message: "Supabase Auth concluiu o login sem retornar o usuário."
    };
    logSupabaseAuthError(details);
    return authErrorResponse(details, request);
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

  if (profileResult.error || roleResult.error || !profile) {
    const details = readSupabaseAuthError(
      profileResult.error ??
        roleResult.error ?? {
          code: "identity_data_unavailable",
          status: 503,
          message: "Perfil ou papéis do usuário não foram encontrados."
        }
    );
    logSupabaseAuthError(details);
    await supabase.auth.signOut();
    return NextResponse.json(
      {
        code: "identity_data_unavailable",
        message: "Não foi possível verificar as permissões da sua conta agora. Tente novamente."
      },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  if (profile.status !== "active") {
    await supabase.auth.signOut();
    return NextResponse.json(
      { message: "Este acesso está indisponível. Entre em contato com o suporte." },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }

  const roles = assignedRoles.map((item) => item.role);
  const role = resolveLoginRole(roles);
  if (!role) {
    const details: SupabaseAuthErrorDetails = {
      code: "identity_roles_unavailable",
      status: 503,
      message: "Nenhum papel foi associado ao usuário autenticado."
    };
    logSupabaseAuthError(details);
    await supabase.auth.signOut();
    return NextResponse.json(
      {
        code: details.code,
        message: "Não foi possível verificar as permissões da sua conta agora. Tente novamente."
      },
      { status: 503, headers: corsHeaders(request) }
    );
  }
  const internalRole = ["admin", "manager", "technical", "operational"].includes(role)
    ? role
    : null;
  const destination = resolveLoginDestination(roles);
  if (!destination) {
    await supabase.auth.signOut();
    return NextResponse.json(
      {
        code: "identity_roles_unavailable",
        message: "Não foi possível determinar o destino desta conta."
      },
      { status: 503, headers: corsHeaders(request) }
    );
  }
  const panelUrl = panelBaseUrl(request);
  let redirectTo =
    role === "customer" || role === "representative"
      ? resolvePostLoginDestination(
          safeInternalPath(login.next, safeInternalPath(destination, "/minha-conta"))
        )
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
  setPersistenceCookie(response, request, login.remember === "on");
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
