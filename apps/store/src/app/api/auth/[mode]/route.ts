import { NextResponse } from "next/server";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(256)
});

const signupSchema = loginSchema
  .extend({
    name: z.string().trim().min(3).max(120),
    confirmPassword: z.string(),
    phone: z.string().max(20).optional(),
    terms: z.literal("on"),
    marketing: z.string().optional()
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"]
  });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ mode: string }> }
) {
  const mode = (await params).mode;
  const payload: unknown = await request.json();
  const parsed = (mode === "signup" ? signupSchema : loginSchema).safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: "Revise os dados informados." }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.json(
      {
        message:
          process.env.NODE_ENV === "production"
            ? "A autenticação está temporariamente indisponível."
            : "Supabase ainda não está conectado. O formulário foi validado, mas nenhuma conta foi alterada."
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  return NextResponse.json(
    { message: "Conecte o Supabase local para concluir este fluxo de autenticação." },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}
