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
    return NextResponse.redirect(destination, 303);
  }
  const user = result.data.user;
  if (user) {
    const metadata = user.user_metadata;
    const fullName = typeof metadata.full_name === "string" ? metadata.full_name : undefined;
    const phone = typeof metadata.phone === "string" ? metadata.phone : undefined;
    if (fullName || phone) {
      await supabase!
        .from("profiles")
        .update({
          ...(fullName ? { full_name: fullName } : {}),
          ...(phone ? { phone } : {})
        })
        .eq("id", user.id);
    }
    const existingConsent = await supabase!
      .from("customer_consents")
      .select("id")
      .eq("user_id", user.id)
      .eq("consent_type", "terms_and_privacy")
      .maybeSingle();
    if (!existingConsent.data && metadata.terms_accepted_at) {
      await supabase!.from("customer_consents").insert({
        user_id: user.id,
        consent_type: "terms_and_privacy",
        accepted: true,
        version: "2026-08"
      });
    }
  }
  return NextResponse.redirect(destination, 303);
}
