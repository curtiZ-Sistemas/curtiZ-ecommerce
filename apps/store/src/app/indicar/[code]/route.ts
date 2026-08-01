import {
  REFERRAL_ATTRIBUTION_COOKIE,
  createReferralAttribution
} from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult } from "@/lib/unknown-data";

const codePattern = /^[A-Z0-9_-]{4,32}$/u;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = (await params).code.trim().toUpperCase();
  const cadastro = new URL("/cadastro", request.url);
  if (!codePattern.test(code)) {
    cadastro.searchParams.set("indicacao", "invalida");
    return NextResponse.redirect(cadastro, 303);
  }

  let valid = process.env.DEMO_MODE === "true" && code === "CURTIZDEMO";
  if (!valid && process.env.DEMO_MODE !== "true") {
    const supabase = await createServerSupabaseClient();
    const result: unknown = supabase
      ? await supabase.rpc("is_valid_referral_code", { p_code: code })
      : null;
    const { data, error } = readQueryResult(result);
    valid = !error && data === true;
  }
  const secret = process.env.AUDIT_HASH_KEY ?? process.env.DEMO_SESSION_SECRET ?? "";
  const token = valid ? createReferralAttribution(code, secret) : null;
  if (!token) {
    cadastro.searchParams.set("indicacao", valid ? "indisponivel" : "invalida");
    return NextResponse.redirect(cadastro, 303);
  }

  cadastro.searchParams.set("indicacao", "confirmada");
  const response = NextResponse.redirect(cadastro, 303);
  response.cookies.set(REFERRAL_ATTRIBUTION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 30 * 24 * 60 * 60
  });
  return response;
}
