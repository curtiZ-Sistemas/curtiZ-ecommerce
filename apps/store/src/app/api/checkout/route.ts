import { randomUUID } from "node:crypto";
import { getIntegrationConfig } from "@curtiz/config";
import { NextResponse } from "next/server";
import { z } from "zod";
import { demoProducts } from "@/lib/catalog";

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
        quantity: z.number().int().min(1).max(10)
      })
    )
    .min(1)
});

export async function POST(request: Request) {
  const integrations = getIntegrationConfig();
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

  for (const line of parsed.data.lines) {
    const product = demoProducts.find((item) => item.id === line.productId);
    if (!product || product.stock < line.quantity) {
      return NextResponse.json(
        { ok: false, message: "Um produto ficou indisponível. Atualize o carrinho." },
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
