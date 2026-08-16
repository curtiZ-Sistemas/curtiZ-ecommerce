import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforcePrivacyRequestRateLimit } from "@/lib/auth-rate-limit";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient
} from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";

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
  email: z.string().trim().email().max(120),
  details: z.string().trim().min(10).max(2000),
  turnstileToken: z.string().max(4096).optional()
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
  if (!(await verifyTurnstile(request, parsed.data.turnstileToken)))
    return NextResponse.json({ message: "Verificação de segurança inválida." }, { status: 400 });
  const publicClient = await createServerSupabaseClient();
  if (
    !(await enforcePrivacyRequestRateLimit({
      request,
      email: parsed.data.email,
      supabase: publicClient
    }))
  )
    return NextResponse.json(
      { message: "Muitas solicitações. Aguarde antes de tentar novamente." },
      { status: 429 }
    );
  const supabase = createServiceSupabaseClient();
  if (!supabase)
    return NextResponse.json({ message: "Canal temporariamente indisponível." }, { status: 503 });
  const userResult = publicClient ? await publicClient.auth.getUser() : null;
  const result = await supabase.rpc("submit_privacy_request", {
    p_request_type: parsed.data.requestType,
    p_requester_name: parsed.data.name,
    p_requester_email: parsed.data.email,
    p_details: parsed.data.details,
    p_customer_id: userResult?.data.user?.id ?? null
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
