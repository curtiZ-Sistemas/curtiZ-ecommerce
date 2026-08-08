import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const schema = z.object({
  requestType: z.enum([
    "confirmation",
    "access",
    "correction",
    "sharing",
    "withdraw_consent",
    "opposition",
    "deletion",
    "portability",
    "automated_review",
    "other"
  ]),
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(254),
  details: z.string().trim().min(10).max(2000)
});
function allowedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return new Set([
    new URL(request.url).origin,
    process.env.NEXT_PUBLIC_STORE_URL,
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim())
  ]).has(origin);
}
export async function POST(request: NextRequest) {
  if (!allowedOrigin(request))
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ message: "Revise os dados da solicitação." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  if (!supabase)
    return NextResponse.json({ message: "Canal temporariamente indisponível." }, { status: 503 });
  const result = await supabase.rpc("submit_privacy_request", {
    p_request_type: parsed.data.requestType,
    p_requester_name: parsed.data.name,
    p_requester_email: parsed.data.email,
    p_details: parsed.data.details
  });
  if (result.error || typeof result.data !== "string")
    return NextResponse.json(
      { message: "Não foi possível registrar a solicitação." },
      { status: 503 }
    );
  return NextResponse.json(
    { protocol: result.data },
    { status: 201, headers: { "cache-control": "no-store" } }
  );
}
