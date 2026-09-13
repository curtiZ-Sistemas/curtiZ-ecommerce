import { getIntegrationConfig } from "@curtiz/config";
import { FIXED_SHIPPING_IN_CENTS, isMercadoPagoTestCredential } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeOptionalCouponCode } from "@/lib/checkout-flow";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { CUSTOMER_EMAIL_MAX_LENGTH, isValidBrazilianPhone, isValidCpf, phoneDigits, sanitizeCpf } from "@/lib/personal-data";
import { encryptPII } from "@/lib/pii";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "@/lib/unknown-data";
import { isCheckoutBusinessError, isMissingAuthentication, safeDatabaseError } from "../../../lib/checkout-diagnostics";

const schema = z.object({
  idempotencyKey: z.string().uuid(),
  couponCode: z.string().trim().max(40).optional(),
  customer: z.object({
    name: z.string().trim().min(3).max(120),
    email: z.string().trim().email().max(CUSTOMER_EMAIL_MAX_LENGTH),
    phone: z.string().trim().max(20).refine(isValidBrazilianPhone).transform(phoneDigits),
    cpf: z.string().max(20).refine((value) => !value || isValidCpf(value)).transform((value) => value ? sanitizeCpf(value) : "")
  }),
  address: z.object({
    postalCode: z.string().regex(/^\D*\d(?:\D*\d){7}\D*$/),
    street: z.string().trim().min(3).max(160), number: z.string().trim().min(1).max(20),
    complement: z.string().trim().max(120).optional(), district: z.string().trim().min(2).max(100),
    city: z.string().trim().min(2).max(100), state: z.string().trim().length(2)
  }),
  lines: z.array(z.object({
    productId: z.string().uuid(), variantId: z.string().uuid(), color: z.string().trim().min(1).max(80),
    size: z.string().trim().min(1).max(40), quantity: z.number().int().min(1).max(10)
  })).min(1).max(50)
});

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const requestIdFor = (request: NextRequest) => {
  const incoming = request.headers.get("x-request-id")?.trim() ?? "";
  return requestIdPattern.test(incoming) ? incoming : crypto.randomUUID();
};
const reply = (requestId: string, body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store", "x-request-id": requestId } });

const readDatabaseError = safeDatabaseError;

const infrastructureErrorCodes = new Set(["PGRST200", "PGRST202", "42P01", "42703", "42883"]);

function logFailure(requestId: string, code: string, error?: unknown) {
  const database = readDatabaseError(error);
  console.error("[checkout-api] checkout not prepared", {
    requestId,
    route: "/api/checkout",
    code,
    databaseCode: database.code || null,
    message: database.message || null,
    details: database.details || null,
    hint: database.hint || null,
    commit: process.env.GIT_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? "not_informed",
    environment: process.env.APP_ENV ?? process.env.NODE_ENV
  });
}

export async function POST(request: NextRequest) {
  const requestId = requestIdFor(request);
  try {
    if (!isAllowedRequestOrigin(request)) {
      return reply(requestId, { ok: false, code: "ORIGIN_NOT_ALLOWED", message: "Origem não permitida." }, 403);
    }

    const integrations = getIntegrationConfig();
    if (!integrations.checkoutEnabled) {
      logFailure(requestId, "CHECKOUT_DISABLED");
      return reply(requestId, {
        ok: false,
        code: "CHECKOUT_DISABLED",
        message: "Novas compras estão temporariamente indisponíveis."
      }, 503);
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      logFailure(requestId, "SUPABASE_PUBLIC_CONFIGURATION_MISSING");
      return reply(requestId, {
        ok: false,
        code: "CHECKOUT_CONFIGURATION_MISSING",
        message: "O checkout está temporariamente indisponível."
      }, 503);
    }
    const auth = await supabase.auth.getUser();
    if (auth.error && !isMissingAuthentication(auth.error)) {
      logFailure(requestId, "SUPABASE_AUTH_QUERY_FAILED", auth.error);
      return reply(requestId, {
        ok: false,
        code: "AUTHENTICATION_UNAVAILABLE",
        message: "Não foi possível validar sua sessão agora."
      }, 503);
    }
    if (!auth.data.user) return reply(requestId, {
      ok: false, code: "AUTHENTICATION_REQUIRED", message: "Entre na sua conta para finalizar a compra.",
      redirectTo: "/login?returnTo=/checkout"
    }, 401);

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(requestId, { ok: false, code: "INVALID_REQUEST", message: "Revise os dados do checkout." }, 400);

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
    const publicKey = process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim();
    if (!integrations.payment.enabled || integrations.payment.provider !== "mercadopago"
      || !isMercadoPagoTestCredential(accessToken) || !isMercadoPagoTestCredential(publicKey)) {
      logFailure(requestId, "PAYMENT_UNAVAILABLE");
      return reply(requestId, { ok: false, code: "PAYMENT_UNAVAILABLE", message: "Pagamento online indisponível no momento." }, 503);
    }

    const couponCode = normalizeOptionalCouponCode(parsed.data.couponCode);
    const lines = parsed.data.lines.map((line) => ({ product_id: line.productId, variant_id: line.variantId, quantity: line.quantity }));
    const quoteResult = readQueryResult(await supabase.rpc("preview_professional_checkout", {
      p_lines: lines, p_coupon_code: couponCode ?? null, p_postal_code: parsed.data.address.postalCode
    }));
    const quote = isUnknownRecord(quoteResult.data) ? quoteResult.data : null;
    if (quoteResult.error || !quote) {
      const database = readDatabaseError(quoteResult.error);
      if (!isCheckoutBusinessError(quoteResult.error)) {
        logFailure(requestId, infrastructureErrorCodes.has(database.code)
          ? "CHECKOUT_MIGRATION_OR_SCHEMA_INVALID" : "CHECKOUT_QUERY_FAILED", quoteResult.error);
        return reply(requestId, {
          ok: false,
          code: infrastructureErrorCodes.has(database.code) ? "CHECKOUT_CONFIGURATION_INVALID" : "CHECKOUT_SERVICE_UNAVAILABLE",
          message: "O checkout está temporariamente indisponível."
        }, 503);
      }
      const invalidCoupon = Boolean(couponCode && database.message.includes("coupon"));
      return reply(requestId, {
        ok: false, code: invalidCoupon ? "INVALID_COUPON" : "CHECKOUT_CHANGED",
        message: invalidCoupon ? "Este cupom não é válido." : "Preço, variante ou estoque mudaram. Revise o carrinho antes de continuar."
      }, 409);
    }

    const subtotalInCents = readNumber(quote, "subtotalInCents");
    const discountInCents = readNumber(quote, "discountInCents");
    const shippingInCents = readNumber(quote, "shippingInCents");
    const amountInCents = readNumber(quote, "amountInCents");
    if (!Number.isSafeInteger(subtotalInCents) || subtotalInCents <= 0
      || !Number.isSafeInteger(discountInCents) || discountInCents < 0
      || shippingInCents !== FIXED_SHIPPING_IN_CENTS
      || amountInCents !== subtotalInCents - discountInCents + shippingInCents) {
      logFailure(requestId, "INVALID_QUOTE");
      return reply(requestId, { ok: false, code: "INVALID_QUOTE", message: "Não foi possível validar o total do checkout." }, 503);
    }

    if (parsed.data.customer.cpf) {
      const identityResult = readQueryResult(await supabase.rpc("save_my_checkout_identity", {
        p_cpf_ciphertext: encryptPII(parsed.data.customer.cpf),
        p_cpf_last_four: parsed.data.customer.cpf.slice(-4)
      }));
      if (identityResult.error) {
        logFailure(requestId, "IDENTITY_PERSISTENCE_FAILED", identityResult.error);
        return reply(requestId, { ok: false, code: "IDENTITY_PERSISTENCE_FAILED", message: "Não foi possível salvar sua identificação agora." }, 503);
      }
    }

    const profileResult = readQueryResult(await supabase.from("profiles").update({
      full_name: parsed.data.customer.name, phone: parsed.data.customer.phone || null, updated_at: new Date().toISOString()
    }).eq("id", auth.data.user.id));
    if (profileResult.error) {
      logFailure(requestId, "PROFILE_PERSISTENCE_FAILED", profileResult.error);
      return reply(requestId, { ok: false, code: "PROFILE_PERSISTENCE_FAILED", message: "Não foi possível salvar seus dados agora." }, 503);
    }

    return reply(requestId, {
      ok: true, subtotalInCents, discountInCents, couponName: readString(quote, "couponName"),
      shippingInCents, amountInCents, publicKey, paymentMode: "test"
    }, 200);
  } catch {
    logFailure(requestId, "CHECKOUT_RUNTIME_FAILURE");
    return reply(requestId, {
      ok: false,
      code: "CHECKOUT_SERVICE_UNAVAILABLE",
      message: "O checkout está temporariamente indisponível."
    }, 503);
  }
}
