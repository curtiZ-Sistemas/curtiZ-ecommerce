import { getIntegrationConfig } from "@curtiz/config";
import { FIXED_SHIPPING_IN_CENTS, isMercadoPagoTestCredential } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import {
  CUSTOMER_EMAIL_MAX_LENGTH,
  isValidBrazilianPhone,
  isValidCpf,
  phoneDigits,
  sanitizeCpf
} from "@/lib/personal-data";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readNumber, readQueryResult } from "@/lib/unknown-data";
import { encryptPII } from "@/lib/pii";

const schema = z.object({
  idempotencyKey: z.string().uuid(),
  customer: z.object({
    name: z.string().trim().min(3).max(120),
    email: z.string().trim().email().max(CUSTOMER_EMAIL_MAX_LENGTH),
    phone: z
      .string()
      .trim()
      .max(20)
      .refine(isValidBrazilianPhone, "Informe um telefone válido com DDD.")
      .transform(phoneDigits),
    cpf: z
      .string()
      .max(20)
      .refine(isValidCpf, "Informe um CPF válido.")
      .transform(sanitizeCpf)
  }),
  address: z.object({
    postalCode: z.string().regex(/^\D*\d(?:\D*\d){7}\D*$/),
    street: z.string().trim().min(3).max(160),
    number: z.string().trim().min(1).max(20),
    complement: z.string().trim().max(120).optional(),
    district: z.string().trim().min(2).max(100),
    city: z.string().trim().min(2).max(100),
    state: z.string().length(2)
  }),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid(),
        color: z.string().trim().min(1).max(80),
        size: z.string().trim().min(1).max(40),
        quantity: z.number().int().min(1).max(10)
      })
    )
    .min(1)
});

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const requestIdFor = (request: NextRequest) => {
  const incoming = request.headers.get("x-request-id")?.trim() ?? "";
  return requestIdPattern.test(incoming) ? incoming : crypto.randomUUID();
};

const checkoutResponse = (
  requestId: string,
  body: Record<string, unknown>,
  status: number
) =>
  NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-request-id": requestId }
  });

const checkoutLog = (requestId: string, status: number, code: string) => {
  console.error("[checkout-api] checkout not completed", {
    requestId,
    route: "/api/checkout",
    endpoint: "POST /api/checkout",
    status,
    code,
    commit: process.env.GIT_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? "not_informed",
    environment: process.env.APP_ENV ?? process.env.NODE_ENV
  });
};

export async function POST(request: NextRequest) {
  const requestId = requestIdFor(request);
  if (!isAllowedRequestOrigin(request)) {
    return checkoutResponse(requestId, { ok: false, message: "Origem não permitida." }, 403);
  }

  const integrations = getIntegrationConfig();
  const supabase = await createServerSupabaseClient();
  const { data: authData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  if (!authData.user) {
    return checkoutResponse(
      requestId,
      {
        ok: false,
        code: "AUTHENTICATION_REQUIRED",
        message: "Entre na sua conta para finalizar a compra.",
        redirectTo: "/login?returnTo=/checkout"
      },
      401
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return checkoutResponse(requestId, { ok: false, message: "Revise os dados do checkout." }, 400);
  }

  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return checkoutResponse(
      requestId,
      {
        ok: false,
        message: "Revise os dados do checkout.",
        issues: parsed.error.flatten().fieldErrors
      },
      400
    );
  }

  if (!integrations.payment.enabled || integrations.payment.provider !== "mercadopago") {
    checkoutLog(requestId, 503, "PAYMENT_UNAVAILABLE");
    return checkoutResponse(
      requestId,
      {
        ok: false,
        code: "PAYMENT_UNAVAILABLE",
        message: "Pagamento online indisponível no momento",
        quote: { subtotalInCents: 0 }
      },
      503
    );
  }

  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
  const publicKey = process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim();
  if (!isMercadoPagoTestCredential(accessToken) || !isMercadoPagoTestCredential(publicKey)) {
    checkoutLog(requestId, 503, "TEST_CREDENTIALS_REQUIRED");
    return checkoutResponse(
      requestId,
      {
        ok: false,
        code: "PAYMENT_UNAVAILABLE",
        message: "O pagamento de teste está indisponível no momento."
      },
      503
    );
  }
  if (!supabase) {
    checkoutLog(requestId, 503, "ORDER_DATABASE_UNAVAILABLE");
    return checkoutResponse(
      requestId,
      { ok: false, message: "Não foi possível preparar o pedido agora. Tente novamente." },
      503
    );
  }

  let cpfCiphertext: string;
  try {
    cpfCiphertext = encryptPII(parsed.data.customer.cpf);
  } catch {
    checkoutLog(requestId, 503, "PII_ENCRYPTION_UNAVAILABLE");
    return checkoutResponse(
      requestId,
      { ok: false, message: "Não foi possível preparar o pedido agora. Tente novamente." },
      503
    );
  }

  const orderResponse: unknown = await supabase.rpc("create_mercadopago_test_order", {
    p_idempotency_key: parsed.data.idempotencyKey,
    p_customer_name: parsed.data.customer.name,
    p_customer_email: parsed.data.customer.email,
    p_customer_phone: parsed.data.customer.phone,
    p_cpf_ciphertext: cpfCiphertext,
    p_cpf_last_four: parsed.data.customer.cpf.slice(-4),
    p_shipping_address: parsed.data.address,
    p_lines: parsed.data.lines.map((line) => ({
      product_id: line.productId,
      variant_id: line.variantId,
      quantity: line.quantity
    })),
    p_reservation_minutes: Number(process.env.INVENTORY_RESERVATION_MINUTES) || 30
  });
  const orderResult = readQueryResult(orderResponse);
  const order = orderResult.data && typeof orderResult.data === "object" && !Array.isArray(orderResult.data)
    ? orderResult.data as Record<string, unknown>
    : null;
  const orderId = typeof order?.orderId === "string" ? order.orderId : "";
  const orderCode = typeof order?.orderCode === "string" ? order.orderCode : "";
  const rpcAmountInCents = Number(order?.amountInCents);
  if (orderResult.error || !orderId || !orderCode || !Number.isSafeInteger(rpcAmountInCents)) {
    const errorCode = orderResult.error && typeof orderResult.error === "object"
      && "code" in orderResult.error && typeof orderResult.error.code === "string"
      ? orderResult.error.code
      : "";
    const unavailable = errorCode === "P0001" || errorCode === "22023";
    if (!unavailable) checkoutLog(requestId, 503, "ORDER_CREATION_FAILED");
    return checkoutResponse(
      requestId,
      {
        ok: false,
        message: unavailable
          ? "Preço, variante ou estoque mudaram. Revise o carrinho antes de continuar."
          : "Não foi possível preparar o pedido agora. Tente novamente."
      },
      unavailable ? 409 : 503
    );
  }

  const totalsResult = readQueryResult(await supabase
    .from("orders")
    .select("subtotal,shipping_total,grand_total")
    .eq("id", orderId)
    .maybeSingle());
  const totals = isUnknownRecord(totalsResult.data) ? totalsResult.data : null;
  const subtotalInCents = totals ? Math.round(readNumber(totals, "subtotal") * 100) : 0;
  const shippingInCents = totals ? Math.round(readNumber(totals, "shipping_total") * 100) : 0;
  const amountInCents = totals ? Math.round(readNumber(totals, "grand_total") * 100) : 0;
  const validTotals = !totalsResult.error
    && subtotalInCents > 0
    && shippingInCents === FIXED_SHIPPING_IN_CENTS
    && amountInCents === subtotalInCents + shippingInCents
    && amountInCents === rpcAmountInCents;
  if (!validTotals) {
    checkoutLog(requestId, 503, "INVALID_ORDER_TOTALS");
    return checkoutResponse(
      requestId,
      { ok: false, message: "Não foi possível validar o total do pedido agora." },
      503
    );
  }

  return checkoutResponse(requestId, {
    ok: true,
    orderId,
    orderCode,
    subtotalInCents,
    shippingInCents,
    amountInCents,
    publicKey,
    paymentMode: "test"
  }, 200);
}
