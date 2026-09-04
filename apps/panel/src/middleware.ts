import { sharedCookieOptions } from "@curtiz/security/auth-cookie";
import {
  AUTH_PERSISTENCE_COOKIE,
  applyAuthCookiePersistence,
  readAuthPersistence
} from "@curtiz/security/auth-persistence";
import { buildNonceContentSecurityPolicy } from "@curtiz/security/content-security-policy";
import { publicCatalogMediaOrigins } from "@/lib/public-media";
import { resolvePublicAppUrls } from "@curtiz/config";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const storeOrigin = resolvePublicAppUrls(request.url).storeUrl;
  const mediaOrigins = publicCatalogMediaOrigins({
    storeUrl: storeOrigin,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL
  });
  const localDevelopment =
    process.env.NODE_ENV === "development" ||
    ["localhost", "127.0.0.1", "::1"].includes(request.nextUrl.hostname);
  const csp = buildNonceContentSecurityPolicy({
    nonce,
    imageSources: [...mediaOrigins],
    mediaSources: [...mediaOrigins],
    connectSources: [
      storeOrigin,
      "https://*.supabase.co",
      "wss://*.supabase.co",
      ...(process.env.NODE_ENV === "development" ? ["http:", "ws:"] : [])
    ],
    development: localDevelopment
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const createNextResponse = () => {
    const next = NextResponse.next({ request: { headers: requestHeaders } });
    next.headers.set("Content-Security-Policy", csp);
    next.headers.set("X-Content-Type-Options", "nosniff");
    next.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    next.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next.headers.set("X-Frame-Options", "DENY");
    if (process.env.NODE_ENV === "production") {
      next.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return next;
  };

  let response = createNextResponse();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !supabasePublishableKey || process.env.DEMO_MODE === "true") {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = createNextResponse();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(
            name,
            value,
            sharedCookieOptions(
              applyAuthCookiePersistence(
                options,
                readAuthPersistence(request.cookies.get(AUTH_PERSISTENCE_COOKIE)?.value)
              ),
              request.nextUrl.hostname
            )
          );
        }
      }
    }
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // A falha de renovação da sessão não deve derrubar o painel.
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};
