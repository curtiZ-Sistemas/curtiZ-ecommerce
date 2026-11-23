import { getIntegrationConfig, getMelhorEnvioEnvironment } from "@curtiz/config";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { configuredMelhorEnvioProvider, resolveShippingProducts } from "@/lib/melhor-envio-server";
import { PrivateRequestError, readPrivateJson, requirePrivateRateLimit } from "@/lib/private-request";
import { commercialKitCheckoutConfigured } from "@/lib/representative-commercial-payments";
import { priceRepresentativeGradeItems } from "@/lib/representative-grade-lines";
import { isRepresentativeKitPostalCode } from "@/lib/representative-resale-scope";
import { KitTransactionError, kitRecord } from "@/lib/representative-test-transactions";
import { getStoreRuntimeEnvironment } from "@/lib/runtime-environment";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { readNumber, readRows, readString } from "@/lib/unknown-data";

const headers = { "cache-control": "private, no-store" };
const grade = z.object({
  kitId: z.string().uuid(),
  template: z.enum(["standard", "lower_restock", "upper_restock"]),
  quantity: z.number().int().min(1).max(99),
  addressId: z.string().uuid(),
  serviceId: z.string().trim().min(1).max(50).optional()
}).strict();

export async function GET() {
  const db = await createServerSupabaseClient();
  const session = db ? await db.auth.getUser() : null;
  if (!db || session?.error || !session?.data.user) {
    return NextResponse.json({ message: "Entre na sua conta." }, { status: 401, headers });
  }

  const result = await db.rpc("list_representative_kit_grade_offers");
  if (result.error || !Array.isArray(result.data)) {
    return NextResponse.json({ message: "Não foi possível carregar as fichas." }, { status: 503, headers });
  }
  const access = await db.rpc("read_representative_kit_buyer_enabled");
  const environment = getStoreRuntimeEnvironment();
  const historyAvailable = Boolean(environment.REPRESENTATIVE_KIT_MP_COLLECTOR_ID);
  return NextResponse.json({
    items: result.data,
    ...(!access.error && typeof access.data === "boolean" ? { buyerEnabled: access.data } : {}),
    ...(historyAvailable ? { orderHistoryAvailable: true, checkoutConfigured: commercialKitCheckoutConfigured(environment) } : {})
  }, { headers });
}

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ message: "Origem não autorizada." }, { status: 403, headers });
  }
  try {
    const parsed = grade.safeParse(await readPrivateJson(request, 1024));
    if (!parsed.success) return NextResponse.json({ message: "Revise a ficha e o endereço." }, { status: 400, headers });
    const auth = await createServerSupabaseClient();
    const session = await auth?.auth.getUser();
    const user = session?.data.user;
    if (!auth || session?.error || !user) throw new KitTransactionError(401);
    await requirePrivateRateLimit(auth, "shipping_quote");
    const db = createServiceSupabaseClient();
    const environment = getStoreRuntimeEnvironment();
    const { shipping } = getIntegrationConfig(environment);
    const originPostalCode = environment.MELHOR_ENVIO_ORIGIN_POSTAL_CODE?.trim() ?? "";
    if (!db || environment.SHIPPING_PREVIEW_ENABLED !== "true" || !shipping.enabled || shipping.provider !== "melhorenvio"
      || getMelhorEnvioEnvironment(environment) !== "production" || !isRepresentativeKitPostalCode(originPostalCode)) {
      throw new KitTransactionError(503);
    }

    const input = parsed.data;
    const args = {
      p_actor: user.id, p_kit: input.kitId, p_template: input.template, p_quantity: input.quantity,
      p_address: input.addressId, p_origin: originPostalCode
    };
    const snapshot = await kitRecord(db, "read_representative_kit_grade_shipping", args);
    const destinationPostalCode = readString(snapshot, "postalCode");
    if (!isRepresentativeKitPostalCode(destinationPostalCode)) throw new KitTransactionError(403);
    const items = priceRepresentativeGradeItems(snapshot.lines, readNumber(snapshot, "priceCents"), input.quantity);
    const lines = readRows(snapshot.lines);
    const resolved = await resolveShippingProducts(lines.map(line => ({
      productId: readString(line, "productId"), variantId: readString(line, "variantId"),
      quantity: readNumber(line, "pairs") * input.quantity
    })), db);
    const products = items.map(item => {
      const shipment = resolved.products.find(product => product.id === item.variantId);
      const line = lines.find(component => component.variantId === item.variantId);
      const quotedDimensions = line?.dimensions;
      const dimensions = [shipment?.weightKg ? Math.round(shipment.weightKg * 1000) : 0,
        shipment?.widthCm, shipment?.heightCm, shipment?.lengthCm];
      if (!shipment || !line || !Array.isArray(quotedDimensions)
        || quotedDimensions.length !== dimensions.length
        || dimensions.some((value, index) => value !== quotedDimensions[index])
        || Math.round(shipment.insuranceValue * 100) !== readNumber(line, "priceCents")) throw new KitTransactionError(409);
      return {
        ...shipment, id: `${item.variantId}-${item.unitPriceInCents}`, quantity: item.quantity,
        insuranceValue: item.unitPriceInCents / 100
      };
    });
    const quotes = await configuredMelhorEnvioProvider(environment, db).quote({ originPostalCode, destinationPostalCode, products });
    if (!input.serviceId) {
      return NextResponse.json({ quotes: quotes.map(option => ({
        serviceId: option.serviceId, service: option.service, carrier: option.carrier,
        shippingInCents: option.amountInCents, estimatedDays: option.estimatedDays
      })) }, { headers });
    }
    const matches = quotes.filter(option => option.serviceId === input.serviceId && option.provider === "melhorenvio");
    const [selected] = matches;
    if (matches.length !== 1 || !selected) throw new KitTransactionError(409);
    const quote = await kitRecord(db, "confirm_representative_kit_grade_shipping", {
      ...args, p_catalog_hash: readString(snapshot, "catalogHash"), p_address_version: readString(snapshot, "addressVersion"),
      p_cart_fingerprint: resolved.fingerprint, p_service_id: selected.serviceId, p_service: selected.service,
      p_carrier: selected.carrier, p_amount_in_cents: selected.amountInCents, p_cost_in_cents: selected.costInCents,
      p_estimated_days: selected.estimatedDays, p_packages: selected.packages, p_expires_at: selected.expiresAt
    });
    return NextResponse.json({ quote: {
      id: quote.id, shippingInCents: quote.shippingInCents, amountInCents: quote.amountInCents,
      purchaseAvailable: quote.purchaseAvailable === true && commercialKitCheckoutConfigured(environment)
    } }, { headers });
  } catch (error) {
    const status = error instanceof KitTransactionError || error instanceof PrivateRequestError ? error.status : 503;
    return NextResponse.json({ message: status === 404 || status === 409
      ? "Ficha, estoque ou endereço indisponível. Revise os dados da compra."
      : "Não foi possível calcular o frete da ficha." }, { status, headers });
  }
}
