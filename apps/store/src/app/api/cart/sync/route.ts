import type { CartLine } from "@curtiz/domain";
import { postgresUuidSchema } from "@curtiz/security";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { demoProducts } from "@/lib/catalog";
import {
  cartSyncErrorCode,
  classifyCartSyncFailure,
  isMissingCartSyncRpc
} from "@/lib/cart-sync-error";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readNumber, readQueryResult } from "@/lib/unknown-data";

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

const productionRequestSchema = requestSchema.extend({
  lines: z
    .array(
      localLineSchema.extend({
        productId: postgresUuidSchema,
        variantId: postgresUuidSchema
      })
    )
    .max(50)
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

const responseHeaders = (requestId: string) => ({
  "cache-control": "no-store",
  "x-request-id": requestId
});

function logCartSyncFailure(
  requestId: string,
  status: number,
  category: string,
  code: string,
  level: "error" | "warn" = "error"
) {
  console[level]("Cart sync failure", {
    requestId,
    route: "/api/cart/sync",
    status,
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
    commit: process.env.CF_PAGES_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "unknown",
    category,
    code
  });
}

function cartErrorResponse(
  requestId: string,
  status: 403 | 422 | 500 | 503,
  error: string,
  message: string
) {
  return NextResponse.json(
    { ok: false, error, requestId, message },
    { status, headers: responseHeaders(requestId) }
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "origin_forbidden", requestId, message: "Origem não permitida." },
      { status: 403, headers: responseHeaders(requestId) }
    );
  }
  const payload: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_cart_payload",
        requestId,
        message: "O carrinho enviado é inválido."
      },
      { status: 400, headers: responseHeaders(requestId) }
    );
  }

  if (process.env.DEMO_MODE === "true") {
    const items = parsed.data.lines.flatMap((line): CartLine[] => {
      const product = demoProducts.find((candidate) => candidate.id === line.productId);
      if (
        !product ||
        line.variantId !== `${product.id}:${line.color}:${line.size}` ||
        !product.colors.includes(line.color) ||
        !product.sizes.includes(line.size) ||
        product.stock < 1
      )
        return [];
      return [
        {
          productId: product.id,
          slug: product.slug,
          variantId: line.variantId,
          name: product.name,
          image: product.image,
          color: line.color,
          size: line.size,
          quantity: Math.min(line.quantity, product.stock, 10),
          maxQuantity: Math.min(product.stock, 10),
          unitPriceInCents: product.priceInCents
        }
      ];
    });
    const changed =
      items.length !== parsed.data.lines.length ||
      items.some((line) => {
        const local = parsed.data.lines.find((candidate) => candidate.variantId === line.variantId);
        return (
          !local ||
          local.quantity !== line.quantity ||
          local.unitPriceInCents !== line.unitPriceInCents
        );
      });
    return NextResponse.json(
      {
        ok: true,
        items,
        cartId: parsed.data.syncCartId ?? crypto.randomUUID(),
        adjustmentMessage: changed
          ? "Preço, disponibilidade ou quantidade foram atualizados conforme o catálogo atual."
          : ""
      },
      { headers: responseHeaders(requestId) }
    );
  }

  const productionCart = productionRequestSchema.safeParse(payload);
  if (!productionCart.success) {
    return cartErrorResponse(
      requestId,
      422,
      "invalid_cart_data",
      "Alguns itens do carrinho não são mais válidos. Revise sua seleção."
    );
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    logCartSyncFailure(requestId, 503, "configuration", "supabase_client_unavailable");
    return cartErrorResponse(
      requestId,
      503,
      "cart_sync_unavailable",
      "A sincronização está temporariamente indisponível."
    );
  }
  let authResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    authResult = await supabase.auth.getUser();
  } catch {
    logCartSyncFailure(requestId, 503, "dependency", "auth_request_failed");
    return cartErrorResponse(
      requestId,
      503,
      "cart_sync_unavailable",
      "A sincronização está temporariamente indisponível."
    );
  }
  const { data: authData } = authResult;
  if (!authData.user) {
    const authStatus = isUnknownRecord(authResult.error)
      ? readNumber(authResult.error, "status")
      : 0;
    if (authStatus >= 500) {
      logCartSyncFailure(requestId, 503, "dependency", "auth_unavailable");
      return cartErrorResponse(
        requestId,
        503,
        "cart_sync_unavailable",
        "A sincronização está temporariamente indisponível."
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "authentication_required",
        requestId,
        message: "Entre para sincronizar o carrinho."
      },
      { status: 401, headers: responseHeaders(requestId) }
    );
  }

  const rpcPayload = {
    p_source_cart_id: productionCart.data.syncCartId ?? null,
    p_lines: productionCart.data.lines.map((line) => ({
      product_id: line.productId,
      color: line.color,
      size: line.size,
      quantity: line.quantity,
      requested_price_cents: line.unitPriceInCents
    }))
  };
  let rpcResponse: unknown;
  try {
    rpcResponse = await supabase.rpc("sync_customer_cart", rpcPayload);
  } catch {
    logCartSyncFailure(requestId, 503, "dependency", "rpc_request_failed");
    return cartErrorResponse(
      requestId,
      503,
      "cart_sync_unavailable",
      "A sincronização está temporariamente indisponível."
    );
  }
  let result = readQueryResult(rpcResponse);
  if (isMissingCartSyncRpc(result.error)) {
    logCartSyncFailure(
      requestId,
      503,
      "schema_mismatch_fallback",
      cartSyncErrorCode(result.error),
      "warn"
    );
    try {
      result = readQueryResult(await supabase.rpc("merge_customer_cart", rpcPayload));
    } catch {
      logCartSyncFailure(requestId, 503, "dependency", "legacy_rpc_request_failed");
      return cartErrorResponse(
        requestId,
        503,
        "cart_sync_unavailable",
        "A sincronização está temporariamente indisponível."
      );
    }
  }
  const { data, error } = result;
  const remote = responseSchema.safeParse(data);
  if (error) {
    const failure = classifyCartSyncFailure(error);
    logCartSyncFailure(requestId, failure.status, failure.category, cartSyncErrorCode(error));
    return cartErrorResponse(
      requestId,
      failure.status,
      failure.error,
      failure.status === 422
        ? "Alguns itens do carrinho não são mais válidos. Revise sua seleção."
        : failure.status === 403
          ? "Sua conta não permite alterar este carrinho."
          : "Não foi possível sincronizar agora. Tente novamente."
    );
  }
  if (!remote.success) {
    logCartSyncFailure(requestId, 500, "contract", "invalid_rpc_response");
    return cartErrorResponse(
      requestId,
      500,
      "cart_sync_failed",
      "Não foi possível sincronizar agora. Tente novamente."
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
    productionCart.data.lines.map((line) => [
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
      ok: true,
      items,
      cartId: remote.data.cartId,
      adjustmentMessage:
        unavailable > 0
          ? `${unavailable} ${unavailable === 1 ? "item indisponível foi removido" : "itens indisponíveis foram removidos"} após validar o estoque.`
          : changed
            ? "Preço ou quantidade foram atualizados conforme o catálogo e o estoque atuais."
            : ""
    },
    { headers: responseHeaders(requestId) }
  );
}
