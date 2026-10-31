import { type NextRequest, NextResponse } from "next/server";
import { resolvePublicAppUrls } from "@curtiz/config";
import { AUTH_PERSISTENCE_COOKIE, safeInternalPath, sharedCookieOptions } from "@curtiz/security";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { PrivateRequestError, readPrivateJson } from "@/lib/private-request";
import { publicBudgetResponse } from "@/lib/public-request";
import { getStoreRuntimeEnvironment } from "@/lib/runtime-environment";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  createGoogleIntent,
  GOOGLE_INTENT_COOKIE,
  googleAuthReady,
  googleCookieOptions,
  googleLoginDestination
} from "@/lib/google-auth";
import { readRows, readString } from "@/lib/unknown-data";

const input = z
  .object({
    terms: z.literal(true),
    marketing: z.boolean().default(false),
    remember: z.boolean().default(false),
    next: z.string().max(300).optional()
  })
  .strict();
export async function POST(request: NextRequest) {
  const fail = (
    status: number,
    message = "Login com Google indisponível no momento. Use e-mail e senha."
  ) =>
    NextResponse.json({ message }, { status, headers: { "cache-control": "private, no-store" } });
  if (!isAllowedRequestOrigin(request)) return fail(403, "Origem não permitida.");
  try {
    const environment = getStoreRuntimeEnvironment();
    if (!(await googleAuthReady(environment))) return fail(503);
    const limited = await publicBudgetResponse(request, "google_oauth", environment);
    if (limited) return limited;
    const parsed = input.safeParse(await readPrivateJson(request, 2048));
    if (!parsed.success)
      return fail(
        400,
        "Aceite os Termos de Uso e a Política de Privacidade para continuar com Google."
      );
    const client = await createServerSupabaseClient({
      persistence: parsed.data.remember ? "persistent" : "session"
    });
    if (!client) return fail(503);
    const session = await client.auth.getUser();
    if (session.data.user) {
      const redirectTo = await googleLoginDestination(
        client,
        session.data.user.id,
        parsed.data.next,
        request.url
      );
      return NextResponse.json(
        { redirectTo, alreadyAuthenticated: true },
        { headers: { "cache-control": "private, no-store" } }
      );
    }
    const legal = await client
      .from("published_legal_documents")
      .select("version_id")
      .in("slug", ["termos-de-uso", "aviso-de-privacidade"]);
    if (legal.error) return fail(503);
    const versions = readRows(legal.data).map((row) => readString(row, "version_id"));
    if (!z.array(z.string().uuid()).max(2).safeParse(versions).success) return fail(503);
    const { intent, token } = createGoogleIntent(
      {
        remember: parsed.data.remember,
        marketing: parsed.data.marketing,
        ...(parsed.data.next ? { next: safeInternalPath(parsed.data.next, "/minha-conta") } : {}),
        versions
      },
      environment.RATE_LIMIT_HMAC_KEY ?? ""
    );
    const callback = new URL("/auth/callback", resolvePublicAppUrls(request.url).storeUrl);
    callback.searchParams.set("google_nonce", intent.nonce);
    const result = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        scopes: "openid email profile",
        skipBrowserRedirect: true
      }
    });
    if (result.error || !result.data.url) return fail(503);
    const authorize = new URL(result.data.url);
    if (
      authorize.origin !== new URL(environment.SUPABASE_URL ?? "").origin ||
      authorize.pathname !== "/auth/v1/authorize"
    )
      return fail(503);
    const response = NextResponse.json(
      { redirectTo: authorize.toString() },
      { headers: { "cache-control": "private, no-store" } }
    );
    response.cookies.set(GOOGLE_INTENT_COOKIE, token, {
      ...googleCookieOptions,
      secure: request.nextUrl.protocol === "https:"
    });
    response.cookies.set(
      AUTH_PERSISTENCE_COOKIE,
      parsed.data.remember ? "persistent" : "session",
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
  } catch (error) {
    return fail(error instanceof PrivateRequestError ? error.status : 503);
  }
}
