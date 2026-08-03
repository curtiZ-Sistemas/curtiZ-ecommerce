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

const demoSessionCookie = "curtiz-demo-session";

const decodeBase64Url = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

async function hasValidDemoSession(value: string | undefined) {
  const secret = process.env.DEMO_SESSION_SECRET?.trim();
  if (!value || !secret || secret.length < 32) return false;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signature),
      new TextEncoder().encode(payload)
    );
    if (!valid) return false;
    const session: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return (
      Boolean(session) &&
      typeof session === "object" &&
      typeof (session as { expiresAt?: unknown }).expiresAt === "number" &&
      (session as { expiresAt: number }).expiresAt > Date.now()
    );
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");

  const csp = buildNonceContentSecurityPolicy({
    nonce,
    imageSources: [
      "https://*.supabase.co"
    ],
    scriptSources: [
      "https://challenges.cloudflare.com"
    ],
    connectSources: [
      "https://*.supabase.co",
      "wss://*.supabase.co",
      "https://api.mercadopago.com",
      "https://challenges.cloudflare.com"
    ],
    frameSources: [
      "https://www.mercadopago.com.br",
      "https://challenges.cloudflare.com"
    ],
    development: process.env.NODE_ENV === "development"
  });

  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const createNextResponse = () => {
    const response = NextResponse.next({
      request: {
        headers: requestHeaders
      }
    });

    response.headers.set("Content-Security-Policy", csp);

    return response;
  };

  let response = createNextResponse();

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const demoSession =
    process.env.DEMO_MODE === "true"
      ? await hasValidDemoSession(request.cookies.get(demoSessionCookie)?.value)
      : false;

  if (!supabaseUrl || !supabasePublishableKey) {
    if (request.nextUrl.pathname === "/checkout" && !demoSession) {
      const login = new URL("/login", request.url);
      login.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(login, 303);
    }
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
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = createNextResponse();

          for (const {
            name,
            value,
            options
          } of cookiesToSet) {
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

  const { data } = await supabase.auth.getUser();
  if (request.nextUrl.pathname === "/checkout" && !data.user && !demoSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login, 303);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};
