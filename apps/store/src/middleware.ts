import { sharedCookieOptions } from "@curtiz/security/auth-cookie";
import { buildNonceContentSecurityPolicy } from "@curtiz/security/content-security-policy";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const DEMO_SESSION_COOKIE = "curtiz-demo-session";
const MAX_RETURN_PATH_LENGTH = 300;

type DemoSessionPayload = {
  expiresAt: number;
};

function isEnabled(value: string | undefined): boolean {
  return ["true", "1", "yes"].includes(value?.trim().toLowerCase() ?? "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!value || value.length > 8_192 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Invalid base64url value.");
  }

  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");

  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function hasValidDemoSession(value: string | undefined): Promise<boolean> {
  const secret = process.env.DEMO_SESSION_SECRET?.trim();

  if (!value || !secret || secret.length < 32 || value.length > 8_192) {
    return false;
  }

  const [payload, signature, extra] = value.split(".");

  if (!payload || !signature || extra) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["verify"]
    );

    const validSignature = await crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(decodeBase64Url(signature)),
      new TextEncoder().encode(payload)
    );

    if (!validSignature) {
      return false;
    }

    const decodedPayload = new TextDecoder("utf-8", {
      fatal: true
    }).decode(decodeBase64Url(payload));

    const session: unknown = JSON.parse(decodedPayload);

    if (!session || typeof session !== "object") {
      return false;
    }

    const expiresAt = (session as Partial<DemoSessionPayload>).expiresAt;

    return typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > Date.now();
  } catch {
    return false;
  }
}

function getSupabaseUrl(): URL | null {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

  if (!configuredUrl) {
    return null;
  }

  try {
    const url = new URL(configuredUrl);

    const isLocalhost = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);

    const validProtocol =
      url.protocol === "https:" ||
      (process.env.NODE_ENV === "development" && isLocalhost && url.protocol === "http:");

    if (!validProtocol) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function isCheckoutRoute(pathname: string): boolean {
  return pathname === "/checkout" || pathname.startsWith("/checkout/");
}

function getSafeReturnPath(request: NextRequest): string {
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  if (
    requestedPath.length === 0 ||
    requestedPath.length > MAX_RETURN_PATH_LENGTH ||
    !requestedPath.startsWith("/") ||
    requestedPath.startsWith("//")
  ) {
    return "/checkout";
  }

  return requestedPath;
}

function applySecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);

  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  response.headers.set("X-Content-Type-Options", "nosniff");

  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  response.headers.set("X-Frame-Options", "DENY");

  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return response;
}

function copyResponseCookies(source: NextResponse, destination: NextResponse): void {
  for (const cookie of source.cookies.getAll()) {
    const { name, value, ...options } = cookie;

    destination.cookies.set(name, value, options);
  }
}

function redirectToLogin(
  request: NextRequest,
  currentResponse: NextResponse,
  csp: string
): NextResponse {
  const loginUrl = new URL("/login", request.url);

  /*
   * A rota de login do projeto usa o campo "next".
   * O valor é criado a partir da URL interna da requisição,
   * evitando redirecionamento para domínios externos.
   */
  loginUrl.searchParams.set("next", getSafeReturnPath(request));

  const redirectResponse = NextResponse.redirect(loginUrl, 303);

  /*
   * Se o Supabase tiver renovado a sessão antes do
   * redirecionamento, os novos cookies não podem ser perdidos.
   */
  copyResponseCookies(currentResponse, redirectResponse);

  redirectResponse.headers.set("Cache-Control", "private, no-store");

  return applySecurityHeaders(redirectResponse, csp);
}

export async function middleware(request: NextRequest) {
  const supabaseUrl = getSupabaseUrl();

  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  const hasValidSupabaseConfiguration = Boolean(
    supabaseUrl && supabasePublishableKey && supabasePublishableKey.length >= 20
  );

  const turnstileEnabled = isEnabled(process.env.TURNSTILE_ENABLED);

  const mercadoPagoEnabled =
    isEnabled(process.env.MERCADO_PAGO_ENABLED) && isEnabled(process.env.CHECKOUT_ENABLED);

  /*
   * crypto.randomUUID gera um valor imprevisível por requisição.
   * O formato hexadecimal não contém caracteres inválidos para CSP.
   */
  const nonce = crypto.randomUUID().replaceAll("-", "");

  const supabaseHttpOrigin = supabaseUrl?.origin;

  const supabaseRealtimeOrigin = supabaseUrl
    ? `${supabaseUrl.protocol === "https:" ? "wss:" : "ws:"}//${supabaseUrl.host}`
    : undefined;

  /*
   * Permite somente o projeto Supabase realmente configurado,
   * em vez de liberar todos os subdomínios *.supabase.co.
   */
  const csp = buildNonceContentSecurityPolicy({
    nonce,

    imageSources: [...(supabaseHttpOrigin ? [supabaseHttpOrigin] : [])],

    scriptSources: [...(turnstileEnabled ? ["https://challenges.cloudflare.com"] : [])],

    connectSources: [
      ...(supabaseHttpOrigin ? [supabaseHttpOrigin] : []),

      ...(supabaseRealtimeOrigin ? [supabaseRealtimeOrigin] : []),

      ...(mercadoPagoEnabled ? ["https://api.mercadopago.com"] : []),

      ...(turnstileEnabled ? ["https://challenges.cloudflare.com"] : [])
    ],

    frameSources: [
      ...(mercadoPagoEnabled ? ["https://www.mercadopago.com.br"] : []),

      ...(turnstileEnabled ? ["https://challenges.cloudflare.com"] : [])
    ],

    development: process.env.NODE_ENV === "development"
  });

  /*
   * O Next.js precisa receber a CSP no cabeçalho interno
   * da requisição para reconhecer e aplicar o nonce.
   */
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("x-nonce", nonce);

  requestHeaders.set("Content-Security-Policy", csp);

  const createNextResponse = () =>
    applySecurityHeaders(
      NextResponse.next({
        request: {
          headers: requestHeaders
        }
      }),
      csp
    );

  let response = createNextResponse();

  const demoSession =
    process.env.DEMO_MODE === "true"
      ? await hasValidDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)
      : false;

  /*
   * Falha de configuração não deve liberar checkout
   * para uma sessão inexistente.
   */
  if (!hasValidSupabaseConfiguration || !supabaseUrl || !supabasePublishableKey) {
    if (isCheckoutRoute(request.nextUrl.pathname) && !demoSession) {
      return redirectToLogin(request, response, csp);
    }

    return response;
  }

  const supabase = createServerClient(supabaseUrl.origin, supabasePublishableKey, {
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
        /*
         * Atualiza a visão dos cookies na requisição atual,
         * permitindo que o restante do processamento enxergue
         * a sessão renovada.
         */
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        /*
         * Recria a resposta com os novos cabeçalhos da
         * requisição e reaplica todos os cabeçalhos de segurança.
         */
        response = createNextResponse();

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, sharedCookieOptions(options, request.nextUrl.hostname));
        }
      }
    }
  });

  let authenticatedUser = false;

  try {
    const { data, error } = await supabase.auth.getUser();

    authenticatedUser = !error && Boolean(data.user);
  } catch {
    /*
     * Em uma rota protegida, falha ao validar a sessão
     * deve resultar em acesso negado, não em liberação.
     */
    authenticatedUser = false;
  }

  if (isCheckoutRoute(request.nextUrl.pathname) && !authenticatedUser && !demoSession) {
    return redirectToLogin(request, response, csp);
  }

  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",

      /*
       * Prefetch não precisa executar validação de sessão,
       * gerar nonce ou fazer uma chamada ao Supabase.
       */
      missing: [
        {
          type: "header",
          key: "next-router-prefetch"
        },
        {
          type: "header",
          key: "purpose",
          value: "prefetch"
        }
      ]
    }
  ]
};
