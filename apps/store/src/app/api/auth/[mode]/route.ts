import { safeInternalPath } from "@curtiz/security";
import { NextResponse } from "next/server";
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

function isAllowedRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return new Set([
    process.env.NEXT_PUBLIC_STORE_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ]).has(origin);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ mode: string }> }
) {
  if (!isAllowedRequest(request)) {
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403 });
  }

  const mode = (await params).mode;
  if (mode !== "login" && mode !== "signup") {
    return NextResponse.json({ message: "Operação inválida." }, { status: 404 });
  }

  const payload: unknown = await request.json();
  const parsed = (mode === "signup" ? signupSchema : loginSchema).safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: "Revise os dados informados." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
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
  const panelUrl = process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001";
  const redirectTo =
    role === "customer"
      ? safeInternalPath(destination, "/minha-conta")
      : new URL(destination, panelUrl).toString();

  return NextResponse.json(
    { message: "Acesso confirmado. Redirecionando…", redirectTo },
    { headers: { "cache-control": "no-store" } }
  );
}
