"use client";

import { MercadoPagoPaymentBrick } from "@/components/mercadopago-payment-brick";
import { PendingPayment } from "@/components/pending-payment";
import { useCart } from "@/components/cart-provider";
import type { MercadoPagoBrickSession } from "@/lib/mercadopago-brick-config";

export function OrderPayment({ orderId, session }: { orderId: string; session: MercadoPagoBrickSession | null }) {
  const { removeMany } = useCart();
  if (!session) return <PendingPayment orderId={orderId} />;
  return <div className="container page-shell checkout-page checkout-bricks-page">
    <MercadoPagoPaymentBrick session={session} onComplete={(status) => { void (async () => {
      if (status === "approved" || status === "pending") {
        sessionStorage.setItem("curtiz-pending-order-cleanup", orderId);
      }
      if (status === "approved") {
        try {
          const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/payment`, { cache: "no-store" });
          const result: unknown = await response.json();
          if (result && typeof result === "object" && "status" in result && result.status === "approved"
            && "variantIds" in result && Array.isArray(result.variantIds)
            && result.variantIds.every((id): id is string => typeof id === "string")) {
            removeMany(result.variantIds);
            sessionStorage.removeItem("curtiz-pending-order-cleanup");
          }
        } catch { /* Preserve cart contents when confirmation is unavailable. */ }
      }
      window.location.assign(`/pedido/${encodeURIComponent(orderId)}/pagamento`);
    })(); }} />
  </div>;
}
