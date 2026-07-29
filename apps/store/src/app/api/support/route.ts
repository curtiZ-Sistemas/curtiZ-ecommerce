import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { sanitizePlainText } from "@curtiz/security";
import { z } from "zod";

const schema = z.object({
  subject: z.string().min(5).max(120),
  message: z.string().min(10).max(4_000),
  category: z.enum(["order", "payment", "delivery", "return", "technical", "other"])
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Revise o atendimento." }, { status: 400 });
  }
  const sanitized = sanitizePlainText(parsed.data.message);
  if (!sanitized) {
    return NextResponse.json({ ok: false, message: "A mensagem está vazia." }, { status: 400 });
  }
  if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      { ok: false, message: "Atendimento temporariamente indisponível." },
      { status: 503 }
    );
  }
  return NextResponse.json(
    {
      ok: true,
      publicCode: `ATD-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
      status: "queued",
      assignedRole: "admin"
    },
    { status: 201, headers: { "cache-control": "no-store" } }
  );
}
