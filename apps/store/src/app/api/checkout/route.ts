import { getIntegrationConfig } from "@curtiz/config";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { demoProducts } from "@/lib/catalog";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult } from "@/lib/unknown-data";

const schema = z.object({
  idempotencyKey: z.string().uuid(),
  customer: z.object({
    name: z.string().trim().min(3).max(120),
    email: z.string().email(),
    phone: z.string().trim().min(8).max(20),
    cpf: z.string().regex(/^\D*\d(?:\D*\d){10}\D*$/)
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
        productId: z.string().min(1),
        variantId: z.string().min(1),
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
  const demoSession =
    process.env.DEMO_MODE === "true"
      ? verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)
      : null;
  if (!authData.user && !demoSession) {
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

  let subtotalInCents = 0;
  if (process.env.DEMO_MODE === "true") {
    for (const line of parsed.data.lines) {
      const product = demoProducts.find((item) => item.id === line.productId);
      const expectedVariantId = product
        ? `${product.id}:${line.color}:${line.size}`
        : "";
      if (
        !product ||
        line.variantId !== expectedVariantId ||
        !product.colors.includes(line.color) ||
        !product.sizes.includes(line.size) ||
        product.stock < line.quantity
      ) {
        return checkoutResponse(
          requestId,
          { ok: false, message: "Um produto ficou indisponível. Atualize o carrinho." },
          409
        );
      }
      subtotalInCents += product.priceInCents * line.quantity;
    }
  } else {
    if (!supabase) {
      checkoutLog(requestId, 503, "CATALOG_VALIDATION_UNAVAILABLE");
      return checkoutResponse(
        requestId,
        { ok: false, message: "Não foi possível validar os itens agora. Tente novamente." },
        503
      );
    }
    const validationResponse: unknown = await supabase.rpc("validate_checkout_lines", {
      p_lines: parsed.data.lines.map((line) => ({
        product_id: line.productId,
        variant_id: line.variantId,
        quantity: line.quantity
      }))
    });
    const validation = readQueryResult(validationResponse);
    const valid =
      validation.data &&
      typeof validation.data === "object" &&
      !Array.isArray(validation.data) &&
      (validation.data as { valid?: unknown }).valid === true;
    if (validation.error || !valid) {
      return checkoutResponse(
        requestId,
        {
          ok: false,
          message:
            "Preço, variante ou estoque mudaram. Revise o carrinho antes de continuar."
        },
        409
      );
    }
    const validatedSubtotal = (validation.data as { subtotalInCents?: unknown }).subtotalInCents;
    if (typeof validatedSubtotal !== "number" || !Number.isSafeInteger(validatedSubtotal)) {
      checkoutLog(requestId, 503, "INVALID_CHECKOUT_QUOTE");
      return checkoutResponse(
        requestId,
        { ok: false, message: "Não foi possível validar os itens agora. Tente novamente." },
        503
      );
    }
    subtotalInCents = validatedSubtotal;
  }

  if (!integrations.payment.enabled || integrations.payment.provider !== "mercadopago") {
    checkoutLog(requestId, 503, "PAYMENT_UNAVAILABLE");
    return checkoutResponse(
      requestId,
      {
        ok: false,
        code: "PAYMENT_UNAVAILABLE",
        message: "Pagamento online indisponível no momento",
        quote: { subtotalInCents }
      },
      503
    );
  }

  if (!integrations.shipping.enabled) {
    checkoutLog(requestId, 503, "SHIPPING_UNAVAILABLE");
    return checkoutResponse(
      requestId,
      {
        ok: false,
        code: "SHIPPING_UNAVAILABLE",
        message: "Não foi possível calcular a entrega para este endereço.",
        quote: { subtotalInCents }
      },
      503
    );
  }

  // O adapter transacional do provedor ainda não está conectado nesta rota. Não se cria
  // pedido, pagamento ou reserva de estoque até receber uma confirmação real do provedor.
  checkoutLog(requestId, 503, "PAYMENT_ADAPTER_UNAVAILABLE");
  return checkoutResponse(
    requestId,
    {
      ok: false,
      code: "PAYMENT_UNAVAILABLE",
      message: "Pagamento online indisponível no momento",
      quote: { subtotalInCents }
    },
    503
  );
}
