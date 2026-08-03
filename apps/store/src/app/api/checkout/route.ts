import { randomUUID } from "node:crypto";
import { getIntegrationConfig } from "@curtiz/config";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { demoProducts } from "@/lib/catalog";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult } from "@/lib/unknown-data";

const schema = z.object({
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

export async function POST(request: NextRequest) {
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
    return NextResponse.json(
      {
        ok: false,
        code: "AUTHENTICATION_REQUIRED",
        message: "Entre na sua conta para finalizar a compra.",
        redirectTo: "/login?returnTo=/checkout"
      },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  if (!integrations.checkoutEnabled) {
    return NextResponse.json(
      {
        success: false,
        ok: false,
        code: "INTEGRATION_DISABLED",
        message: "A finalização de compras estará disponível em breve."
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise os dados do checkout.",
        issues: parsed.error.flatten().fieldErrors
      },
      { status: 400 }
    );
  }

  if (process.env.DEMO_MODE === "true") {
    for (const line of parsed.data.lines) {
      const product = demoProducts.find((item) => item.id === line.productId);
      if (
        !product ||
        !product.colors.includes(line.color) ||
        !product.sizes.includes(line.size) ||
        product.stock < line.quantity
      ) {
        return NextResponse.json(
          { ok: false, message: "Um produto ficou indisponível. Atualize o carrinho." },
          { status: 409 }
        );
      }
    }
  } else {
    const validationResponse: unknown = await supabase!.rpc("validate_checkout_lines", {
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
      return NextResponse.json(
        {
          ok: false,
          message:
            "Preço, variante ou estoque mudaram. Revise o carrinho antes de continuar."
        },
        { status: 409 }
      );
    }
  }

  if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      { ok: false, message: "Checkout temporariamente indisponível." },
      { status: 503 }
    );
  }

  if (
    integrations.payment.provider === "mock" &&
    integrations.shipping.provider === "mock" &&
    process.env.DEMO_MODE === "true"
  ) {
    const orderCode = `CZT-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    return NextResponse.json(
      {
        success: true,
        ok: true,
        orderCode,
        code: "ORDER_CREATED",
        message: "Pedido criado. Nenhum pagamento foi processado."
      },
      { status: 201, headers: { "cache-control": "no-store", "x-demo-mode": "true" } }
    );
  }

  if (
    integrations.payment.provider !== "mercadopago" ||
    integrations.shipping.provider !== "melhorenvio"
  ) {
    return NextResponse.json(
      {
        success: false,
        ok: false,
        code: "INTEGRATION_CONFIGURATION_ERROR",
        message: "A finalização de compras está temporariamente indisponível."
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  // Pedido e preferência serão criados transacionalmente pelo Supabase/adapter real.
  // Esta rota não produz aprovação, frete ou pedido fictício.
  const orderCode = `CZT-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  return NextResponse.json(
    {
      ok: false,
      orderCode,
      code: "INTEGRATION_NOT_READY",
      message: "Checkout temporariamente indisponível."
    },
    {
      status: 503,
      headers: { "cache-control": "no-store", "x-request-id": randomUUID() }
    }
  );
}
