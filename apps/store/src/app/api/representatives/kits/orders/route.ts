import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { PrivateRequestError, readPrivateJson, requirePrivateRateLimit } from "@/lib/private-request";
import {
  beginCommercialKitPix, cancelCommercialKitPayment, commercialKitCheckoutConfigured, commercialKitCollector, commercialKitPaymentProvider,
  kitPaymentView, refreshCommercialKitPayment
} from "@/lib/representative-commercial-payments";
import { isRepresentativeKitPostalCode } from "@/lib/representative-resale-scope";
import { KitTransactionError, kitCall, kitRecord } from "@/lib/representative-test-transactions";
import { getStoreRuntimeEnvironment } from "@/lib/runtime-environment";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

const orderId = z.string().uuid();
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve"), variantId: z.string().uuid(), quoteId: z.string().uuid(),
    addressId: z.string().uuid(), quantity: z.number().int().min(1).max(99), idempotencyKey: z.string().uuid() }).strict(),
  z.object({ action: z.literal("pix"), orderId }).strict(),
  z.object({ action: z.literal("status"), orderId }).strict(),
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("return"), orderId, quantity: z.number().int().min(1).max(99),
    reason: z.string().trim().min(5).max(500), idempotencyKey: z.string().uuid() }).strict(),
  z.object({ action: z.literal("cancel"), orderId }).strict()
]);

const reply = (body: object, status: number) => Response.json(body, {
  status, headers: { "cache-control": "private, no-store" }
});

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) return reply({ message: "Origem não autorizada." }, 403);
  try {
    const parsed = input.safeParse(await readPrivateJson(request, 2048));
    if (!parsed.success) return reply({ message: "Revise os dados do pedido." }, 400);
    const data = parsed.data;
    const auth = await createServerSupabaseClient();
    const session = await auth?.auth.getUser();
    const user = session?.data.user;
    if (!auth || session?.error || !user) throw new KitTransactionError(401);
    const environment = getStoreRuntimeEnvironment();
    if ((data.action === "reserve" || data.action === "pix") && !commercialKitCheckoutConfigured(environment)) {
      return reply({ code: "RESALE_NOT_HOMOLOGATED", message: "A compra de kits aguarda homologação." }, 409);
    }
    await requirePrivateRateLimit(auth, {
      reserve: "checkout_quote", pix: "payment_attempt", status: "payment_reconcile", cancel: "order_cancel", list: "customer_write",
      return: "return_request"
    }[data.action]);
    const db = createServiceSupabaseClient();
    if (!db) throw new KitTransactionError(503);
    if (data.action === "list") {
      const orders = await kitCall(db, "list_representative_kit_orders", { p_actor: user.id });
      return reply({ ok: true, orders }, 200);
    }
    if (data.action === "return") {
      const request = await kitRecord(db, "request_representative_kit_return", {
        p_actor: user.id, p_order: data.orderId, p_quantity: data.quantity, p_reason: data.reason, p_key: data.idempotencyKey
      });
      return reply({ ok: true, request }, 200);
    }
    const provider = commercialKitPaymentProvider(environment);
    const collector = commercialKitCollector(environment);
    if (data.action === "reserve") {
      const originPostalCode = environment.MELHOR_ENVIO_ORIGIN_POSTAL_CODE?.trim() ?? "";
      if (!isRepresentativeKitPostalCode(originPostalCode)) throw new KitTransactionError(503);
      const order = await kitRecord(db, "reserve_representative_kit_order", {
        p_actor: user.id, p_variant: data.variantId, p_quantity: data.quantity, p_quote: data.quoteId,
        p_address: data.addressId, p_key: data.idempotencyKey, p_origin_postal_code: originPostalCode
      });
      return reply({ ok: true, order: kitPaymentView(order) }, 200);
    }
    if (data.action === "pix") {
      if (!user.email || !user.email_confirmed_at) throw new KitTransactionError(403);
      const order = await beginCommercialKitPix(db, provider, collector, { id: user.id, email: user.email }, data.orderId.toLowerCase());
      return reply({ ok: true, order }, 200);
    }
    const order = data.action === "cancel"
      ? await cancelCommercialKitPayment(db, provider, collector, user.id, data.orderId.toLowerCase())
      : await refreshCommercialKitPayment(db, provider, collector, user.id, data.orderId.toLowerCase());
    if (data.action === "cancel") return reply({ ok: true, order }, 200);
    const [tracking, returns] = await Promise.all([
      kitCall(db, "read_representative_kit_tracking", { p_actor: user.id, p_order: data.orderId }),
      kitCall(db, "list_representative_kit_returns", { p_actor: user.id, p_order: data.orderId })
    ]);
    return reply({ ok: true, order, tracking, returns }, 200);
  } catch (error) {
    const status = error instanceof KitTransactionError || error instanceof PrivateRequestError ? error.status : 503;
    return reply({ message: status >= 500 ? "Não foi possível confirmar o estado. Consulte o pedido antes de tentar novamente."
      : "Não foi possível concluir a operação do kit." }, status);
  }
}
