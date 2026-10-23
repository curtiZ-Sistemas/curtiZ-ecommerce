import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { PrivateRequestError, readPrivateJson, requirePrivateRateLimit } from "@/lib/private-request";
import { resolveShippingProducts } from "@/lib/melhor-envio-server";
import { CheckoutIdentityError, resolveCheckoutPayerDocument } from "@/lib/checkout-identity";
import { isUnknownRecord, readString } from "@/lib/unknown-data";
import { KitTransactionError, kitCall, kitRecord, kitTestProvider, beginKitPix, cancelKitTestOrder, refundKitTestOrder, reconcileKitTestPayment } from "@/lib/representative-test-transactions";

const id = z.string().uuid();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), variantId: id, quantity: z.number().int().min(1).max(99), quoteId: id, addressId: id, idempotencyKey: id }).strict(),
  z.object({ action: z.literal("pay_pix"), orderId: id, payerDocument: z.string().max(20).optional() }).strict(),
  z.object({ action: z.enum(["read", "reconcile", "cancel"]), orderId: id }).strict(),
  z.object({ action: z.literal("refund"), orderId: id, idempotencyKey: id, amountInCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()
]);
const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ message: "Origem não autorizada." }, { status: 403, headers });
  try {
    const input = schema.safeParse(await readPrivateJson(request, 4096));
    if (!input.success) return NextResponse.json({ message: "Revise os dados informados." }, { status: 400, headers });
    const session = await createServerSupabaseClient();
    const user = session ? (await session.auth.getUser()).data.user : null;
    const db = createServiceSupabaseClient();
    if (!user || !session) return NextResponse.json({ message: "Entre na sua conta." }, { status: 401, headers });
    if (!db) throw new KitTransactionError(503);
    kitTestProvider(); // Production mode never opens this TEST-only transaction boundary.
    await requirePrivateRateLimit(session, "customer_write");
    const data = input.data;
    if ((data.action === "create" || data.action === "pay_pix")
      && (process.env.REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED !== "true" || process.env.REPRESENTATIVE_TEST_ACTOR_ID !== user.id)) {
      throw new KitTransactionError(403);
    }
    let orderId: string;
    if (data.action === "create") {
      const variant = await db.from("product_variants").select("product_id").eq("id", data.variantId).maybeSingle();
      if (variant.error || !isUnknownRecord(variant.data)) throw new KitTransactionError(404);
      const resolved = await resolveShippingProducts([{ productId: readString(variant.data, "product_id"), variantId: data.variantId, quantity: data.quantity }], db);
      const created = await kitRecord(db, "create_kit_test_checkout", { p_actor: user.id, p_variant: data.variantId,
        p_quantity: data.quantity, p_quote: data.quoteId, p_fingerprint: resolved.fingerprint, p_key: data.idempotencyKey, p_address: data.addressId });
      orderId = readString(created, "orderId");
    } else {
      orderId = data.orderId;
      const context = await kitRecord(db, "read_kit_test_transaction", { p_actor: user.id, p_order: orderId });
      if (data.action === "pay_pix") {
        const profile = await db.from("profiles").select("full_name,status").eq("id", user.id).maybeSingle();
        if (profile.error || !isUnknownRecord(profile.data) || profile.data.status !== "active" || !user.email) throw new KitTransactionError(403);
        // TEST payer identification belongs to the provider; never save it as customer identity.
        const document = await resolveCheckoutPayerDocument(db, user.id, data.payerDocument ?? "", "test");
        await beginKitPix(db, { id: user.id, email: user.email }, orderId, document, readString(profile.data, "full_name"));
      } else if (data.action === "reconcile" && readString(context, "providerPaymentId")) {
        await reconcileKitTestPayment(db, await kitTestProvider().getPayment(readString(context, "providerPaymentId")));
      } else if (data.action === "cancel") await cancelKitTestOrder(db, user.id, orderId);
      else if (data.action === "refund") await refundKitTestOrder(db, user.id, orderId, data.idempotencyKey, data.amountInCents);
    }
    const transaction = await kitRecord(db, "read_kit_test_transaction", { p_actor: user.id, p_order: orderId });
    const instructions = await kitCall(db, "read_kit_test_payment_instructions", { p_actor: user.id, p_order: orderId });
    // Fingerprint and provider identity stay server-side; only own payment instructions are returned.
    return NextResponse.json({ ok: true, orderId, mode: "test", state: transaction.state, amountInCents: transaction.amountInCents,
      refundedInCents: transaction.refundedInCents, remainingInCents: transaction.remainingInCents,
      fiscalValidation: "pending", shippingAllowed: false, instructions }, { headers });
  } catch (error) {
    const status = error instanceof KitTransactionError || error instanceof PrivateRequestError || error instanceof CheckoutIdentityError ? error.status : 503;
    return NextResponse.json({ message: "Não foi possível concluir a operação. Consulte o pedido antes de tentar novamente." }, { status, headers });
  }
}

