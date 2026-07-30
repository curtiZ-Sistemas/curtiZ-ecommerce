import {
  DEMO_SESSION_COOKIE,
  authenticateDemoAccount,
  createDemoSession,
  demoDestination,
  isLocalDemoRequest,
  safeInternalPath,
  verifyDemoSession
} from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(256),
  remember: z.string().optional()
});

const signupSchema = loginSchema
  .omit({ remember: true })
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
  operational: "/operacional",
  admin: "/administracao",
  manager: "/gerencia",
  technical: "/tecnico"
};

const profileSchema = z.object({ status: z.string() }).nullable();
const roleSchema = z.object({ role: z.string() }).nullable();

export async function GET(request: NextRequest, { params }: { params: Promise<{ mode: string }> }) {
  if ((await params).mode !== "session") {
    return NextResponse.json({ message: "Operação inválida." }, { status: 404 });
  }

  const demoSession = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demoSession) {
    return NextResponse.json(
      { authenticated: true, fullName: demoSession.fullName },
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
    account.role === "customer"
      ? destination
      : new URL(destination, panelBaseUrl(request)).toString();
  const response = NextResponse.json(
    { message: "Acesso confirmado. Redirecionando…", redirectTo },
    { headers: { "cache-control": "no-store" } }
  );
  response.cookies.set(DEMO_SESSION_COOKIE, session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    ...(session.maxAge ? { maxAge: session.maxAge } : {})
  });
  return response;
}

function isAllowedRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return new Set([
    process.env.NEXT_PUBLIC_STORE_URL,
    process.env.NEXT_PUBLIC_PANEL_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001"
  ]).has(origin);
}

export async function POST(request: Request, { params }: { params: Promise<{ mode: string }> }) {
  if (!isAllowedRequest(request)) {
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403 });
  }

  const mode = (await params).mode;
  if (mode !== "login" && mode !== "signup" && mode !== "logout") {
    return NextResponse.json({ message: "Operação inválida." }, { status: 404 });
  }

  if (mode === "logout") {
    const supabase = await createServerSupabaseClient();
    if (supabase) await supabase.auth.signOut();

    const origin = request.headers.get("origin");
    const headers: Record<string, string> = { "cache-control": "no-store" };
    if (origin) {
      headers["access-control-allow-origin"] = origin;
      headers["access-control-allow-credentials"] = "true";
      headers.vary = "Origin";
    }
    const response = NextResponse.json(
      { message: "Sessão encerrada.", redirectTo: "/login" },
      { headers }
    );
    response.cookies.set(DEMO_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: 0
    });
    return response;
  }

  const payload: unknown = await request.json();
  const parsed = (mode === "signup" ? signupSchema : loginSchema).safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: "Revise os dados informados." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
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

  const [profileResult, roleResult] = await Promise.all([
    supabase.from("profiles").select("status").eq("id", data.user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", data.user.id).maybeSingle()
  ]);
  const rawProfile: unknown = profileResult.data;
  const rawRole: unknown = roleResult.data;
  const profile = profileSchema.safeParse(rawProfile).data ?? null;
  const assignedRole = roleSchema.safeParse(rawRole).data ?? null;

  if (profile?.status && profile.status !== "active") {
    await supabase.auth.signOut();
    return NextResponse.json(
      { message: "Este acesso está indisponível. Entre em contato com o suporte." },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }

  const role = assignedRole?.role ?? "customer";
  const destination = roleDestinations[role] ?? "/minha-conta";
  const panelUrl = panelBaseUrl(request);
  const redirectTo =
    role === "customer"
      ? safeInternalPath(destination, "/minha-conta")
      : new URL(destination, panelUrl).toString();

  return NextResponse.json(
    { message: "Acesso confirmado. Redirecionando…", redirectTo },
    { headers: { "cache-control": "no-store" } }
  );
}
