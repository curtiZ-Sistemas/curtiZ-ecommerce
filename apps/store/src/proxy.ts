import { buildNonceContentSecurityPolicy, sharedCookieOptions } from "@curtiz/security";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = buildNonceContentSecurityPolicy({
    nonce,
    imageSources: ["https://*.supabase.co"],
    scriptSources: ["https://challenges.cloudflare.com"],
    connectSources: [
      "https://*.supabase.co",
      "wss://*.supabase.co",
      "https://api.mercadopago.com",
      "https://challenges.cloudflare.com"
    ],
    frameSources: ["https://www.mercadopago.com.br", "https://challenges.cloudflare.com"],
    development: process.env.NODE_ENV === "development"
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const nextResponse = () => {
    const next = NextResponse.next({ request: { headers: requestHeaders } });
    next.headers.set("Content-Security-Policy", csp);
    return next;
  };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let response = nextResponse();
  if (!url || !key || process.env.DEMO_MODE === "true") return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = nextResponse();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(
            name,
            value,
            sharedCookieOptions(options, request.nextUrl.hostname)
          );
        }
      }
    }
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
