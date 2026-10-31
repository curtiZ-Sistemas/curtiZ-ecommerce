import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { resolvePublicAppUrls } from "@curtiz/config";
import {
  AUTH_PERSISTENCE_COOKIE,
  sharedCookieOptions,
  verifyReferralAttribution,
  REFERRAL_ATTRIBUTION_COOKIE
} from "@curtiz/security";
import { createServerSupabaseClient } from "./supabase/server";
import { getStoreRuntimeEnvironment } from "./runtime-environment";
import {
  GOOGLE_INTENT_COOKIE,
  googleCookieOptions,
  readGoogleIntent,
  googleLoginDestination,
  recordGoogleConsents
} from "./google-auth";

export async function googleCallback(request: NextRequest) {
  const { storeUrl } = resolvePublicAppUrls(request.url);
  const redirect = (destination: string) => {
    const response = NextResponse.redirect(new URL(destination, storeUrl), 303);
    response.headers.set("cache-control", "private, no-store");
    response.cookies.set(GOOGLE_INTENT_COOKIE, "", {
      ...googleCookieOptions,
      secure: request.nextUrl.protocol === "https:",
      maxAge: 0
    });
    return response;
  };
  const fail = () => redirect("/login?reason=google_oauth_error");
  let client: Awaited<ReturnType<typeof createServerSupabaseClient>> = null;
  let exchanged = false;
  try {
    const environment = getStoreRuntimeEnvironment();
    const intent = readGoogleIntent(
      request.cookies.get(GOOGLE_INTENT_COOKIE)?.value,
      request.nextUrl.searchParams.get("google_nonce"),
      environment.RATE_LIMIT_HMAC_KEY ?? ""
    );
    const code = request.nextUrl.searchParams.get("code");
    if (
      environment.GOOGLE_AUTH_ENABLED !== "true" ||
      !intent ||
      !code ||
      request.nextUrl.searchParams.has("error")
    )
      return fail();
    client = await createServerSupabaseClient({
      persistence: intent.remember ? "persistent" : "session"
    });
    if (!client) return fail();
    // A second login must not silently replace a session established in another tab.
    const current = await client.auth.getUser();
    if (current.data.user)
      return redirect(
        await googleLoginDestination(
          client,
          current.data.user.id,
          intent.next,
          request.url
        )
      );
    const result = await client.auth.exchangeCodeForSession(code);
    if (result.error || !result.data.user) return fail();
    exchanged = true;
    if (!result.data.user.identities?.some((identity) => identity.provider === "google"))
      throw new Error("Provider mismatch");
    const destination = await googleLoginDestination(
      client,
      result.data.user.id,
      intent.next,
      request.url
    );
    await recordGoogleConsents(client, result.data.user.id, intent);
    const referral = verifyReferralAttribution(
      request.cookies.get(REFERRAL_ATTRIBUTION_COOKIE)?.value,
      environment.REFERRAL_ATTRIBUTION_HMAC_KEY ?? ""
    );
    if (referral) await client.rpc("claim_referral_attribution", { p_code: referral.code });
    const response = redirect(destination);
    response.cookies.set(
      AUTH_PERSISTENCE_COOKIE,
      intent.remember ? "persistent" : "session",
      sharedCookieOptions(
        {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          secure: request.nextUrl.protocol === "https:",
          ...(intent.remember ? { maxAge: 365 * 24 * 60 * 60 } : {})
        },
        request.nextUrl.hostname
      )
    );
    return response;
  } catch {
    if (exchanged && client) await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    return fail();
  }
}
