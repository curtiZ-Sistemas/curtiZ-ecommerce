import { FIXED_SHIPPING_IN_CENTS, isMercadoPagoTestCredential } from "@curtiz/integrations";
import { notFound } from "next/navigation";
import { OrderPayment } from "@/components/order-payment";
import type { MercadoPagoBrickSession } from "@/lib/mercadopago-brick-config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "@/lib/unknown-data";

export const metadata = { title: "Pagamento do pedido", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!supabase || !user) notFound();
  const [orderResponse, paymentResponse] = await Promise.all([
    supabase.from("orders").select("id,public_code,customer_id,customer_email_snapshot,status,subtotal,discount_total,shipping_total,grand_total")
      .eq("id", id).eq("customer_id", user.id).maybeSingle(),
    supabase.from("payments").select("provider_payment_id,status").eq("order_id", id).eq("provider", "mercadopago").maybeSingle()
  ]);
  const order = readQueryResult(orderResponse).data;
  const payment = readQueryResult(paymentResponse).data;
  if (!isUnknownRecord(order) || !isUnknownRecord(payment)) notFound();
  const publicKey = process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim() ?? "";
  const subtotalInCents = Math.round(readNumber(order, "subtotal") * 100);
  const discountInCents = Math.round(readNumber(order, "discount_total") * 100);
  const shippingInCents = Math.round(readNumber(order, "shipping_total") * 100);
  const amountInCents = Math.round(readNumber(order, "grand_total") * 100);
  const canResume = readString(order, "status") === "pending_payment"
    && !readString(payment, "provider_payment_id") && isMercadoPagoTestCredential(publicKey)
    && subtotalInCents > 0 && discountInCents >= 0 && shippingInCents === FIXED_SHIPPING_IN_CENTS
    && amountInCents === subtotalInCents - discountInCents + shippingInCents;
  const session: MercadoPagoBrickSession | null = canResume ? {
    orderId: id,
    orderCode: readString(order, "public_code"),
    subtotalInCents,
    discountInCents,
    couponName: "",
    shippingInCents,
    amountInCents,
    publicKey,
    idempotencyKey: id,
    email: readString(order, "customer_email_snapshot"),
    cpf: ""
  } : null;
  return <OrderPayment orderId={id} session={session} />;
}
