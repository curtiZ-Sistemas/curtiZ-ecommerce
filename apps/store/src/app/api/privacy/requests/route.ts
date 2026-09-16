import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforcePrivacyRequestRateLimit } from "@/lib/auth-rate-limit";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient
} from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { PrivateRequestError, readPrivateJson } from "@/lib/private-request";

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
export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request))
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403 });
  let body: unknown;
  try { body = await readPrivateJson(request, 8 * 1024); }
  catch (error) { return NextResponse.json({ message: "Revise os dados da solicitação." },
    { status: error instanceof PrivateRequestError ? error.status : 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ message: "Revise os dados da solicitação." }, { status: 400 });
  if (!(await verifyTurnstile(request, parsed.data.turnstileToken)))
    return NextResponse.json({ message: "Verificação de segurança inválida." }, { status: 400 });
  const publicClient = await createServerSupabaseClient();
  const supabase = createServiceSupabaseClient();
  const rateLimit = await enforcePrivacyRequestRateLimit({
      request,
      email: parsed.data.email,
      supabase
    });
  if (rateLimit.status === "blocked")
    return NextResponse.json(
      { message: "Muitas solicitações. Aguarde antes de tentar novamente." },
      { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } }
    );
  if (rateLimit.status === "error")
    return NextResponse.json(
      { message: "A prote\u00e7\u00e3o do canal est\u00e1 temporariamente indispon\u00edvel." },
      { status: 503 }
    );
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
