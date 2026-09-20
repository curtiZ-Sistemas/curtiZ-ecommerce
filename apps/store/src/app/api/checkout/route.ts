import { logServerEvent } from "@curtiz/security";
import { getIntegrationConfig } from "@curtiz/config";
import { FIXED_SHIPPING_IN_CENTS, isMercadoPagoTestCredential } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkoutMissingFields, normalizeOptionalCouponCode, type CheckoutRequiredField } from "@/lib/checkout-flow";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { CUSTOMER_EMAIL_MAX_LENGTH, isValidBrazilianPhone, isValidCpf, phoneDigits, sanitizeCpf } from "@/lib/personal-data";
import { CheckoutIdentityError, readCustomerCheckoutCpf, saveCustomerCheckoutIdentity } from "../../../lib/checkout-identity";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "@/lib/unknown-data";
import { isCheckoutBusinessError, isMissingAuthentication, safeDatabaseError } from "../../../lib/checkout-diagnostics";
import { PrivateRequestError, readPrivateJson, requirePrivateRateLimit } from "@/lib/private-request";
import { resolveShippingProducts } from "../../../lib/melhor-envio-server";

const schema = z.object({
  idempotencyKey: z.string().uuid(),
  shippingQuoteId: z.string().uuid().optional(),
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

const incompleteFields = (error: z.ZodError): CheckoutRequiredField[] => {
  const fields = new Set<CheckoutRequiredField>();
  for (const issue of error.issues) {
    const [section, field] = issue.path;
    if (section === "customer" && ["name", "email", "phone", "cpf"].includes(String(field))) {
      fields.add(field as CheckoutRequiredField);
    } else if (section === "address"
      && ["postalCode", "street", "number", "district", "city", "state"].includes(String(field))) {
      fields.add(field as CheckoutRequiredField);
    } else if (section === "lines") fields.add("items");
  }
  return [...fields];
};

function logFailure(requestId: string, code: string, error?: unknown) {
  const database = readDatabaseError(error);
  logServerEvent("error", "checkout_api_checkout_not_prepared", {
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

    try {
      await requirePrivateRateLimit(supabase, "checkout_quote");
    } catch (error) {
      const status = error instanceof PrivateRequestError ? error.status : 503;
      return reply(requestId, { ok: false, code: status === 429 ? "RATE_LIMITED" : "ABUSE_PROTECTION_UNAVAILABLE",
        message: status === 429 ? "Aguarde antes de recalcular o checkout." : "O checkout está temporariamente indisponível." }, status);
    }

    let body: unknown;
    try { body = await readPrivateJson(request, 32 * 1024); }
    catch (error) {
      const status = error instanceof PrivateRequestError ? error.status : 400;
      return reply(requestId, { ok: false, code: status === 413 ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST",
        message: status === 413 ? "Os dados do checkout excedem o limite permitido." : "Revise os dados do checkout." }, status);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const missingFields = incompleteFields(parsed.error);
      return missingFields.length
        ? reply(requestId, { ok: false, code: "CHECKOUT_INCOMPLETE", missingFields,
          message: "Complete os dados obrigatórios antes de continuar." }, 409)
        : reply(requestId, { ok: false, code: "INVALID_REQUEST", message: "Revise os dados do checkout." }, 400);
    }

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
    let shippingInCents = readNumber(quote, "shippingInCents");
    let shippingQuoteId: string | null = null;
    if (integrations.shipping.provider === "melhorenvio") {
      if (!parsed.data.shippingQuoteId) return reply(requestId, { ok: false, code: "SHIPPING_QUOTE_REQUIRED",
        message: "Calcule e selecione uma opção de frete antes de continuar." }, 409);
      const resolved = await resolveShippingProducts(parsed.data.lines);
      const selectedResult = readQueryResult(await supabase.from("shipping_quotes")
        .select("id,provider,amount,destination_postal_code,cart_fingerprint,expires_at,used_at")
        .eq("id", parsed.data.shippingQuoteId).eq("customer_id", auth.data.user.id).maybeSingle());
      const selected = isUnknownRecord(selectedResult.data) ? selectedResult.data : null;
      const postalCode = parsed.data.address.postalCode.replace(/\D/gu, "");
      if (selectedResult.error || !selected || readString(selected, "provider") !== "melhorenvio"
        || readString(selected, "destination_postal_code") !== postalCode
        || readString(selected, "cart_fingerprint") !== resolved.fingerprint
        || Date.parse(readString(selected, "expires_at")) <= Date.now() || readString(selected, "used_at")) {
        return reply(requestId, { ok: false, code: "SHIPPING_QUOTE_EXPIRED",
          message: "A cotação expirou ou o carrinho mudou. Calcule o frete novamente." }, 409);
      }
      shippingInCents = Math.round(readNumber(selected, "amount") * 100);
      shippingQuoteId = readString(selected, "id");
    }
    const amountInCents = subtotalInCents - discountInCents + shippingInCents;
    if (!Number.isSafeInteger(subtotalInCents) || subtotalInCents <= 0
      || !Number.isSafeInteger(discountInCents) || discountInCents < 0
      || !Number.isSafeInteger(shippingInCents) || shippingInCents < 0
      || (integrations.shipping.provider === "fixed" && shippingInCents !== FIXED_SHIPPING_IN_CENTS)
      || amountInCents !== subtotalInCents - discountInCents + shippingInCents) {
      logFailure(requestId, "INVALID_QUOTE");
      return reply(requestId, { ok: false, code: "INVALID_QUOTE", message: "Não foi possível validar o total do checkout." }, 503);
    }

    const identityDb = createServiceSupabaseClient();
    if (!identityDb) {
      logFailure(requestId, "IDENTITY_CONFIGURATION_MISSING");
      return reply(requestId, { ok: false, code: "CHECKOUT_SERVICE_UNAVAILABLE",
        message: "O checkout está temporariamente indisponível." }, 503);
    }
    if (parsed.data.customer.cpf) {
      try {
        await saveCustomerCheckoutIdentity(identityDb, auth.data.user.id, parsed.data.customer.cpf);
      } catch {
        logFailure(requestId, "IDENTITY_PERSISTENCE_FAILED");
        return reply(requestId, { ok: false, code: "IDENTITY_PERSISTENCE_FAILED", message: "Não foi possível salvar sua identificação agora." }, 503);
      }
    }
    try {
      await readCustomerCheckoutCpf(identityDb, auth.data.user.id);
    } catch (error) {
      if (error instanceof CheckoutIdentityError && error.code === "CUSTOMER_IDENTITY_REQUIRED") {
        return reply(requestId, { ok: false, code: "CHECKOUT_INCOMPLETE", missingFields: ["cpf"],
          message: "Informe e salve o CPF antes de continuar." }, 409);
      }
      logFailure(requestId, "IDENTITY_VALIDATION_FAILED");
      return reply(requestId, { ok: false, code: "CHECKOUT_SERVICE_UNAVAILABLE",
        message: "Não foi possível validar sua identificação agora." }, 503);
    }

    const missingFields = checkoutMissingFields({
      customer: parsed.data.customer, address: parsed.data.address,
      cpfConfigured: true, itemCount: parsed.data.lines.length
    });
    if (missingFields.length) return reply(requestId, { ok: false, code: "CHECKOUT_INCOMPLETE", missingFields,
      message: "Complete os dados obrigatórios antes de continuar." }, 409);

    const profileResult = readQueryResult(await supabase.from("profiles").update({
      full_name: parsed.data.customer.name, phone: parsed.data.customer.phone || null, updated_at: new Date().toISOString()
    }).eq("id", auth.data.user.id));
    if (profileResult.error) {
      logFailure(requestId, "PROFILE_PERSISTENCE_FAILED", profileResult.error);
      return reply(requestId, { ok: false, code: "PROFILE_PERSISTENCE_FAILED", message: "Não foi possível salvar seus dados agora." }, 503);
    }

    return reply(requestId, {
      ok: true, subtotalInCents, discountInCents, couponName: readString(quote, "couponName"),
      shippingInCents, shippingQuoteId, amountInCents, publicKey, paymentMode: "test"
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
