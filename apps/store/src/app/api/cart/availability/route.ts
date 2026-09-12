import { NextResponse } from "next/server";
import { z } from "zod";

import { demoProducts } from "@/lib/catalog";
import { isVariantActuallyAvailable } from "@/lib/cart-availability";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { readRows, readString } from "@/lib/unknown-data";

const headers = {
  "cache-control": "no-store"
};

const requestSchema = z.object({
  variantIds: z
    .array(z.string().trim().min(1).max(180))
    .max(50)
});

const uuidArraySchema = z
  .array(z.string().uuid())
  .max(50);

function json(
  body: unknown,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers
  });
}

function getDemoAvailability(
  variantIds: string[]
) {
  return variantIds.map((variantId) => ({
    variantId,
    available: demoProducts.some((product) =>
      product.colors.some((color) =>
        product.sizes.some(
          (size) =>
            `${product.id}:${color}:${size}` ===
            variantId
        )
      )
    )
  }));
}

function logSupabaseError(
  context: string,
  error: {
    code?: string | null;
    message?: string | null;
    details?: string | null;
    hint?: string | null;
  }
) {
  /*
   * Não registre URLs, tokens, cookies ou chaves.
   * Estes campos são suficientes para diagnosticar
   * erros de RPC/Postgres nos logs da Cloudflare.
   */
  console.error(`[cart/availability] ${context}`, {
    code: error.code ?? null,
    message: error.message ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null
  });
}

export async function POST(
  request: Request
) {
  /*
   * Protege o endpoint contra requisições vindas
   * de origens não autorizadas.
   */
  if (!isAllowedRequestOrigin(request)) {
    return json(
      {
        error: "origin_not_allowed"
      },
      403
    );
  }

  /*
   * Faz o parse do body sem permitir que JSON inválido
   * gere uma exceção não tratada.
   */
  const body: unknown = await request
    .json()
    .catch(() => null);

  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return json(
      {
        error: "invalid_request"
      },
      400
    );
  }

  /*
   * Evita consultar a mesma variação várias vezes
   * dentro de uma única requisição.
   */
  const variantIds = [
    ...new Set(parsed.data.variantIds)
  ];

  if (variantIds.length === 0) {
    return json({
      items: []
    });
  }

  /*
   * DEMO_MODE utiliza IDs próprios que não precisam
   * necessariamente ser UUID.
   */
  if (process.env.DEMO_MODE === "true") {
    return json({
      items: getDemoAvailability(
        variantIds
      )
    });
  }

  /*
   * Fora do modo demo, as variantes reais precisam
   * ser UUIDs válidos antes de chegarem ao Postgres.
   */
  const ids = uuidArraySchema.safeParse(
    variantIds
  );

  if (!ids.success) {
    return json(
      {
        error: "invalid_variant_ids"
      },
      400
    );
  }

  /*
   * Cria um cliente server-only para consultar somente
   * as variantes solicitadas sem expor a chave secreta.
   *
   * Se retornar null, falta configuração do banco no Worker.
   */
  const supabase =
    createServiceSupabaseClient();

  if (!supabase) {
    console.error(
      "[cart/availability] Server database client could not be created. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)."
    );

    return json(
      {
        error:
          "availability_service_unavailable"
      },
      503
    );
  }

  try {
    /*
     * Consulta as tabelas existentes diretamente. Isso evita
     * transformar uma RPC ainda não aplicada em indisponibilidade.
     */
    const result = await supabase
      .from("product_variants")
      .select("id,active,inventory(available_quantity),products!inner(status)")
      .in("id", ids.data);
    const { error } = result;

    if (error) {
      logSupabaseError(
        "product variant availability query failed",
        error
      );

      return json(
        {
          error:
            "availability_query_failed"
        },
        503
      );
    }

    /*
     * Nunca devolve null em "items".
     * Isso simplifica o consumo no frontend.
     */
    const availableIds = new Set(readRows(result.data)
      .filter(isVariantActuallyAvailable)
      .map((row) => readString(row, "id"))
      .filter(Boolean));
    const items = ids.data.map((variantId) => ({
      variantId,
      available: availableIds.has(variantId)
    }));

    return json({
      items
    });
  } catch (error) {
    /*
     * Captura inclusive erros de rede ou exceções
     * inesperadas do cliente Supabase.
     */
    console.error(
      "[cart/availability] Unexpected availability error",
      error instanceof Error
        ? {
            name: error.name,
            message: error.message
          }
        : {
            message: "Unknown error"
          }
    );

    return json(
      {
        error:
          "availability_service_unavailable"
      },
      503
    );
  }
}
