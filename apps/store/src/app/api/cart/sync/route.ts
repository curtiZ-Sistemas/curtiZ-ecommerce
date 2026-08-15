import type { CartLine } from "@curtiz/domain";
import { postgresUuidSchema } from "@curtiz/security";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult } from "@/lib/unknown-data";

export const dynamic = "force-dynamic";

const localLineSchema = z.object({
  productId: z.string().trim().min(1).max(80),
  variantId: z.string().trim().min(1).max(180),
  name: z.string().trim().min(1).max(180),
  slug: z.string().trim().max(180).optional(),
  image: z.string().trim().max(500),
  color: z.string().trim().min(1).max(80),
  size: z.string().trim().min(1).max(40),
  quantity: z.number().int().min(1).max(99),
  maxQuantity: z.number().int().min(1).max(99).optional(),
  unitPriceInCents: z.number().int().nonnegative()
});

const requestSchema = z.object({
  lines: z.array(localLineSchema).max(50),
  syncCartId: z.string().uuid().optional()
});

const remoteLineSchema = z.object({
  productId: postgresUuidSchema,
  slug: z.string(),
  variantId: postgresUuidSchema,
  name: z.string(),
  imagePath: z.string().nullable().optional(),
  color: z.string(),
  size: z.string(),
  quantity: z.coerce.number().int().min(1).max(99),
  maxQuantity: z.coerce.number().int().min(1).max(99),
  unitPriceInCents: z.coerce.number().int().nonnegative()
});

const responseSchema = z.object({
  items: z.array(remoteLineSchema),
  cartId: z.string().uuid()
});

function publicCatalogImage(path: string | null | undefined) {
  if (!path) return "/icon.svg";
  if (path.startsWith("/") || path.startsWith("https://")) return path;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url
    ? `${url}/storage/v1/object/public/catalog-public/${path.replace(/^catalog-public\//u, "")}`
    : "/icon.svg";
}

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }
  const payload: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "O carrinho enviado é inválido." },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(
      { message: "Carrinho salvo neste dispositivo." },
      { headers: { "cache-control": "no-store", "x-demo-mode": "true" } }
    );
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { message: "Sincronização indisponível." },
      { headers: { "cache-control": "no-store" } }
    );
  }
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json(
      { message: "Entre para sincronizar o carrinho." },
      { headers: { "cache-control": "no-store" } }
    );
  }

  const rpcResponse: unknown = await supabase.rpc("merge_customer_cart", {
    p_source_cart_id: parsed.data.syncCartId ?? null,
    p_lines: parsed.data.lines.map((line) => ({
      product_id: line.productId,
      color: line.color,
      size: line.size,
      quantity: line.quantity,
      requested_price_cents: line.unitPriceInCents
    }))
  });
  const { data, error } = readQueryResult(rpcResponse);
  const remote = responseSchema.safeParse(data);
  if (error || !remote.success) {
    return NextResponse.json(
      {
        message:
          "Não foi possível sincronizar com a conta. O carrinho continua preservado neste dispositivo."
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const items: CartLine[] = remote.data.items.map((line) => ({
    productId: line.productId,
    slug: line.slug,
    variantId: line.variantId,
    name: line.name,
    image: publicCatalogImage(line.imagePath),
    color: line.color,
    size: line.size,
    quantity: line.quantity,
    maxQuantity: line.maxQuantity,
    unitPriceInCents: line.unitPriceInCents
  }));
  const normalizedLocal = new Map(
    parsed.data.lines.map((line) => [
      `${line.productId}:${line.color.toLocaleLowerCase("pt-BR")}:${line.size.toLocaleLowerCase("pt-BR")}`,
      line
    ])
  );
  const remoteKeys = new Set(
    items.map(
      (line) =>
        `${line.productId}:${line.color.toLocaleLowerCase("pt-BR")}:${line.size.toLocaleLowerCase("pt-BR")}`
    )
  );
  const unavailable = [...normalizedLocal.keys()].filter((key) => !remoteKeys.has(key)).length;
  const changed = items.some((line) => {
    const local = normalizedLocal.get(
      `${line.productId}:${line.color.toLocaleLowerCase("pt-BR")}:${line.size.toLocaleLowerCase("pt-BR")}`
    );
    return Boolean(
      local &&
        (local.quantity !== line.quantity || local.unitPriceInCents !== line.unitPriceInCents)
    );
  });

  return NextResponse.json(
    {
      items,
      cartId: remote.data.cartId,
      adjustmentMessage:
        unavailable > 0
          ? `${unavailable} ${unavailable === 1 ? "item indisponível foi removido" : "itens indisponíveis foram removidos"} após validar o estoque.`
          : changed
            ? "Preço ou quantidade foram atualizados conforme o catálogo e o estoque atuais."
            : parsed.data.lines.length
              ? "Carrinho sincronizado com sua conta."
              : ""
    },
    { headers: { "cache-control": "no-store" } }
  );
}
