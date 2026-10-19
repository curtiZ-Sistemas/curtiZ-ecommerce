import { safeInternalPath } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolvePublicAppUrls } from "@curtiz/config";
import { resolveLoginReturn } from "@/lib/auth-routing";
import { GOOGLE_INTENT_COOKIE } from "@/lib/google-auth";
import { googleCallback } from "@/lib/google-callback";
import {
  RECOVERY_PATH,
  RECOVERY_REQUEST_PATH,
  hasPasswordIdentity,
  recoveryFreshness
} from "@/lib/password-recovery";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.has("google_nonce") || (request.nextUrl.searchParams.has("error") && request.cookies.has(GOOGLE_INTENT_COOKIE))) return googleCallback(request);
  const code = request.nextUrl.searchParams.get("code");
  const next = safeInternalPath(request.nextUrl.searchParams.get("next"), "/minha-conta");
  const { storeUrl, panelUrl } = resolvePublicAppUrls(request.url);
  const destination = new URL(resolveLoginReturn(next, panelUrl), storeUrl);
  const recovery = next === RECOVERY_PATH;
  // Recovery links land on the request page, which explains the problem and offers a new link.
  const failRecovery = () => {
    const failure = new URL(RECOVERY_REQUEST_PATH, storeUrl);
    failure.searchParams.set("reason", "link_expired");
    return NextResponse.redirect(failure, 303);
  };
  if (!code) {
    if (recovery) return failRecovery();
    destination.host = new URL(storeUrl).host;
    destination.pathname = "/login";
    destination.search = "?erro=link-invalido";
    return NextResponse.redirect(destination, 303);
  }
  const supabase = await createServerSupabaseClient();
  const result = supabase ? await supabase.auth.exchangeCodeForSession(code) : null;
  if (!result || result.error) {
    if (recovery) return failRecovery();
    destination.host = new URL(storeUrl).host;
    destination.pathname = "/login";
    destination.search = "?erro=link-expirado";
    return NextResponse.redirect(destination, 303);
  }
  if (recovery) {
    // Only a session minted by a recovery link may reach the password form.
    const user = result.data.user;
    const freshness = recoveryFreshness(result.data.session?.access_token);
    if (freshness !== "ok" || !user) {
      await supabase!.auth.signOut({ scope: "local" });
      return failRecovery();
    }
    if (!hasPasswordIdentity(user)) {
      await supabase!.auth.signOut({ scope: "local" });
      return NextResponse.redirect(new URL("/login?reason=google_account", storeUrl), 303);
    }
    return NextResponse.redirect(destination, 303);
  }
  const user = result.data.user;
  if (user?.app_metadata.provider === "google") {
    await supabase!.auth.signOut({ scope: "local" });
    return NextResponse.redirect(new URL("/login?reason=google_oauth_error", storeUrl), 303);
  }
  if (user) {
    const metadata = user.user_metadata;
    const fullName = typeof metadata.full_name === "string" ? metadata.full_name : undefined;
    const phone = typeof metadata.phone === "string" ? metadata.phone : undefined;
    // Fill missing signup data atomically; never overwrite later customer edits.
    if (fullName) await supabase!.from("profiles").update({ full_name: fullName }).eq("id", user.id).is("full_name", null);
    if (phone) await supabase!.from("profiles").update({ phone }).eq("id", user.id).is("phone", null);
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
