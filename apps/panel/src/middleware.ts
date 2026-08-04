import { sharedCookieOptions } from "@curtiz/security/auth-cookie";
import { buildNonceContentSecurityPolicy } from "@curtiz/security/content-security-policy";

import {
  createServerClient,
  type CookieOptions
} from "@supabase/ssr";
import {
  type NextRequest,
  NextResponse
} from "next/server";

export async function middleware(
  request: NextRequest
) {
  const nonce = crypto
    .randomUUID()
    .replaceAll("-", "");

  const storeOrigin = (() => {
    try {
      return new URL(
        process.env.NEXT_PUBLIC_STORE_URL ??
          "http://localhost:3000"
      ).origin;
    } catch {
      return "http://localhost:3000";
    }
  })();

  const csp =
    buildNonceContentSecurityPolicy({
      nonce,

      imageSources: [
        "https://*.supabase.co"
      ],

      connectSources: [
        storeOrigin,
        "https://*.supabase.co",
        "wss://*.supabase.co",
        ...(process.env.NODE_ENV ===
        "development"
          ? ["http:", "ws:"]
          : [])
      ],

      development:
        process.env.NODE_ENV === "development"
    });

  const requestHeaders = new Headers(
    request.headers
  );

  requestHeaders.set("x-nonce", nonce);

  requestHeaders.set(
    "Content-Security-Policy",
    csp
  );

  const createNextResponse = () => {
    const next = NextResponse.next({
      request: {
        headers: requestHeaders
      }
    });

    next.headers.set(
      "Content-Security-Policy",
      csp
    );

    next.headers.set(
      "X-Content-Type-Options",
      "nosniff"
    );

    next.headers.set(
      "Referrer-Policy",
      "strict-origin-when-cross-origin"
    );

    return next;
  };

  let response = createNextResponse();

  const supabaseUrl =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL
      ?.trim();

  const supabasePublishableKey =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ?.trim();

  if (
    !supabaseUrl ||
    !supabasePublishableKey ||
    process.env.DEMO_MODE === "true"
  ) {
    return response;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options: CookieOptions;
          }>
        ) {
          for (
            const {
              name,
              value
            } of cookiesToSet
          ) {
            request.cookies.set(
              name,
              value
            );
          }

          response = createNextResponse();

          for (
            const {
              name,
              value,
              options
            } of cookiesToSet
          ) {
            response.cookies.set(
              name,
              value,
              sharedCookieOptions(
                options,
                request.nextUrl.hostname
              )
            );
          }
        }
      }
    }
  );

  try {
    await supabase.auth.getUser();
  } catch {
    // A falha de renovação da sessão não deve derrubar o painel.
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};