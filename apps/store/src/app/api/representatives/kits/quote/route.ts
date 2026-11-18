import { type NextRequest, NextResponse } from "next/server";
import { getIntegrationConfig, getMelhorEnvioEnvironment } from "@curtiz/config";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { PrivateRequestError, readPrivateJson, requirePrivateRateLimit } from "@/lib/private-request";
import { configuredMelhorEnvioProvider, resolveShippingProducts } from "@/lib/melhor-envio-server";
import { getStoreRuntimeEnvironment } from "@/lib/runtime-environment";
import { isUnknownRecord, readRows, readString, readNumber } from "@/lib/unknown-data";
import { KitTransactionError, kitTestProvider } from "@/lib/representative-test-transactions";
import { createShippingPreviewCache, shippingPreviewKey } from "@/lib/shipping-preview";

const selection = { variantId: z.string().uuid(), quantity: z.number().int().min(1).max(99) };
const postalCodeSchema = z.string().regex(/^\d{8}$/u);
const schema = z.union([
  z.object({ ...selection, postalCode: postalCodeSchema, mode: z.literal("preview").optional() }).strict(),
  z.object({ ...selection, mode: z.literal("checkout"), addressId: z.string().uuid(),
    serviceId: z.string().min(1).max(50) }).strict()
]);
const headers = { "cache-control": "private, no-store" };
const cachedPreview = createShippingPreviewCache();

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ message: "Origem não autorizada." }, { status: 403, headers });
  try {
    const parsed = schema.safeParse(await readPrivateJson(request, 1024));
    if (!parsed.success) return NextResponse.json({ message: "Revise o kit, a quantidade e o CEP." }, { status: 400, headers });
    const input = parsed.data;
    const isPreview = input.mode === "preview";
    const isCheckout = input.mode === "checkout";
    const auth = await createServerSupabaseClient();
    const session = auth ? await auth.auth.getUser() : null;
    const user = session?.data.user;
    if (!auth || session?.error || !user) throw new KitTransactionError(401);
    if (!isPreview && !isCheckout) {
      if (process.env.REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED !== "true" || process.env.REPRESENTATIVE_TEST_ACTOR_ID !== user.id) throw new KitTransactionError(403);
      kitTestProvider();
    }
    const environment = getStoreRuntimeEnvironment();
    const providerEnvironment = getMelhorEnvioEnvironment(environment);
    if (isPreview || isCheckout) {
      const { shipping } = getIntegrationConfig(environment);
      if (environment.SHIPPING_PREVIEW_ENABLED !== "true" || !shipping.enabled
        || shipping.provider !== "melhorenvio" || providerEnvironment !== "production") throw new KitTransactionError(503);
    } else if (providerEnvironment !== "sandbox") {
      throw new KitTransactionError(503);
    }
    await requirePrivateRateLimit(auth, "shipping_quote");
    const context = await auth.rpc("read_representative_catalog_kit_context", { p_variant_id: input.variantId, p_quantity: input.quantity });
    if (context.error) throw new KitTransactionError(503);
    if (!isUnknownRecord(context.data)) throw new KitTransactionError(403);
    const item = readRows(context.data.items)[0];
    if (!item || readNumber(item, "available") < input.quantity) throw new KitTransactionError();
    let postalCode: string;
    if (input.mode === "checkout") {
      const address = await auth.from("addresses").select("postal_code").eq("id", input.addressId)
        .eq("user_id", user.id).eq("country", "BR").maybeSingle();
      if (address.error) throw new KitTransactionError(503);
      if (!isUnknownRecord(address.data)) throw new KitTransactionError(404);
      postalCode = readString(address.data, "postal_code").replace(/\D/gu, "");
      if (!postalCodeSchema.safeParse(postalCode).success) throw new KitTransactionError();
    } else {
      postalCode = input.postalCode;
    }
    const db = createServiceSupabaseClient();
    if (!db) throw new KitTransactionError(503);
    const variant = await db.from("product_variants").select("product_id").eq("id", input.variantId).maybeSingle();
    if (variant.error || !isUnknownRecord(variant.data)) throw new KitTransactionError(503);
    const productId = readString(variant.data, "product_id");
    const resolved = await resolveShippingProducts([{ productId, variantId: input.variantId, quantity: input.quantity }], db);
    const originPostalCode = environment.MELHOR_ENVIO_ORIGIN_POSTAL_CODE?.trim() ?? "";
    const quote = () => configuredMelhorEnvioProvider(environment, db).quote({
      originPostalCode, destinationPostalCode: postalCode, products: resolved.products
    });
    if (isPreview) {
      const key = shippingPreviewKey({ productId, variantId: input.variantId, postalCode,
        originPostalCode, environment: "production", products: resolved.products });
      const estimates = await cachedPreview(key, quote);
      return NextResponse.json({ ok: true, mode: "preview", quotes: estimates }, { headers });
    }
    const quotes = await quote();
    if (input.mode === "checkout") {
      const matchingQuotes = quotes.filter(option => option.serviceId === input.serviceId);
      const [selected] = matchingQuotes;
      if (matchingQuotes.length !== 1 || !selected || selected.provider !== "melhorenvio") throw new KitTransactionError();
      const saved = await db.rpc("issue_representative_kit_shipping_quote", {
        p_actor: user.id, p_variant: input.variantId, p_quantity: input.quantity, p_address: input.addressId,
        p_postal_code: postalCode, p_cart_fingerprint: resolved.fingerprint, p_service_id: selected.serviceId,
        p_service: selected.service, p_carrier: selected.carrier, p_amount_in_cents: selected.amountInCents,
        p_cost_in_cents: selected.costInCents, p_estimated_days: selected.estimatedDays, p_packages: selected.packages,
        p_expires_at: selected.expiresAt
      });
      if (saved.error) throw new KitTransactionError(503);
      if (!isUnknownRecord(saved.data)) throw new KitTransactionError();
      return NextResponse.json({ ok: true, mode: "checkout", quote: saved.data }, { headers });
    }
    if (!quotes.length) return NextResponse.json({ ok: true, quotes: [] }, { headers });
    const saved = await db.from("shipping_quotes").insert(quotes.map(q => ({ customer_id: user.id, provider: q.provider,
      service_id: q.serviceId, service: q.service, carrier: q.carrier, amount: q.amountInCents / 100, cost: q.costInCents / 100,
      estimated_days: q.estimatedDays, packages: q.packages, destination_postal_code: postalCode, cart_fingerprint: resolved.fingerprint,
      provider_environment: "sandbox", provider_payload: { packages: q.packages }, expires_at: q.expiresAt })))
      .select("id,service,carrier,amount,estimated_days,expires_at");
    if (saved.error || !Array.isArray(saved.data) || saved.data.length !== quotes.length) throw new KitTransactionError(503);
    return NextResponse.json({ ok: true, quotes: readRows(saved.data).map(q => ({ id: readString(q, "id"), service: readString(q, "service"),
      carrier: readString(q, "carrier"), amountInCents: Math.round(readNumber(q, "amount") * 100), estimatedDays: readNumber(q, "estimated_days"), expiresAt: readString(q, "expires_at") })) }, { headers });
  } catch (error) {
    const status = error instanceof KitTransactionError ? error.status : error instanceof PrivateRequestError ? error.status : 503;
    return NextResponse.json({ message: "Não foi possível calcular o frete do kit agora." }, { status, headers });
  }
}
