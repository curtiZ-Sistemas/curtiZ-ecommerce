import { safeInternalPath } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeInternalPath(request.nextUrl.searchParams.get("next"), "/minha-conta");
  const destination = new URL(next, request.url);
  if (!code) {
    destination.pathname = "/login";
    destination.search = "?erro=link-invalido";
    return NextResponse.redirect(destination, 303);
  }
  const supabase = await createServerSupabaseClient();
  const result = supabase ? await supabase.auth.exchangeCodeForSession(code) : null;
  if (!result || result.error) {
    destination.pathname = "/login";
    destination.search = "?erro=link-expirado";
  }
  return NextResponse.redirect(destination, 303);
}
