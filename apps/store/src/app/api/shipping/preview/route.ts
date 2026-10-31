import { getIntegrationConfig, getMelhorEnvioEnvironment } from "@curtiz/config";
import { MelhorEnvioError } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { PrivateRequestError, readPrivateJson } from "@/lib/private-request";
import { publicBudgetResponse } from "@/lib/public-request";
import { configuredMelhorEnvioProvider, resolveShippingProducts } from "@/lib/melhor-envio-server";
import { getStoreRuntimeEnvironment } from "@/lib/runtime-environment";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { createShippingPreviewCache, shippingPreviewKey } from "@/lib/shipping-preview";

const schema = z.object({
  postalCode: z.string().regex(/^\d{5}-?\d{3}$/u).transform((value) => value.replace("-", "")),
  productId: z.string().uuid(), variantId: z.string().uuid(), quantity: z.number().int().min(1).max(10)
}).strict();
const cachedPreview = createShippingPreviewCache();
const unavailable = "A prévia de frete está temporariamente indisponível. Tente novamente mais tarde.";

export async function POST(request: NextRequest) {
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body,
    { status, headers: { "cache-control": "private, no-store" } });
  if (!isAllowedRequestOrigin(request)) return reply({ ok: false, message: "Origem não permitida." }, 403);
  try {
    const environment = getStoreRuntimeEnvironment();
    const config = getIntegrationConfig(environment);
    // Opt-in plus production provider only: sandbox prices must never reach shoppers.
    if (environment.SHIPPING_PREVIEW_ENABLED !== "true" || !config.shipping.enabled
      || config.shipping.provider !== "melhorenvio" || getMelhorEnvioEnvironment(environment) !== "production") {
      return reply({ ok: false, code: "SHIPPING_PREVIEW_UNAVAILABLE", message: unavailable }, 503);
    }
    const limited = await publicBudgetResponse(request, "shipping_preview", environment);
    if (limited) return limited;
    const parsed = schema.safeParse(await readPrivateJson(request, 2048));
    if (!parsed.success) return reply({ ok: false, message: "Revise o CEP, o tamanho e a quantidade (1 a 10)." }, 400);
    const db = createServiceSupabaseClient();
    if (!db) return reply({ ok: false, message: unavailable }, 503);
    const { productId, variantId, quantity, postalCode } = parsed.data;
    // Always resolve the live catalog, including the kit's own official package, before looking in cache.
    const resolved = await resolveShippingProducts([{ productId, variantId, quantity }], db);
    const originPostalCode = environment.MELHOR_ENVIO_ORIGIN_POSTAL_CODE?.trim() ?? "";
    const key = shippingPreviewKey({ productId, variantId, postalCode, originPostalCode,
      environment: getMelhorEnvioEnvironment(environment) ?? "", products: resolved.products });
    const quotes = await cachedPreview(key, () => configuredMelhorEnvioProvider(environment, db).quote({
      originPostalCode, destinationPostalCode: postalCode, products: resolved.products
    }));
    return reply({ ok: true, quotes, message: quotes.length ? undefined : "Nenhum serviço atende este CEP e este produto." });
  } catch (error) {
    if (error instanceof PrivateRequestError) return reply({ ok: false, message: "Revise os dados informados." }, error.status);
    if (error instanceof MelhorEnvioError && error.code === "validation") {
      return reply({ ok: false, message: "Não foi possível cotar este CEP e esta combinação de produto." }, 409);
    }
    return reply({ ok: false, message: unavailable }, 503);
  }
}
