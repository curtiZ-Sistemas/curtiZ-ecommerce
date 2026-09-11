"use client";

import { MercadoPagoPaymentBrick } from "@/components/mercadopago-payment-brick";
import { PendingPayment } from "@/components/pending-payment";
import type { MercadoPagoBrickSession } from "@/lib/mercadopago-brick-config";

export function OrderPayment({ orderId, session }: { orderId: string; session: MercadoPagoBrickSession | null }) {
  if (!session) return <PendingPayment orderId={orderId} />;
  return <div className="container page-shell checkout-page checkout-bricks-page">
    <MercadoPagoPaymentBrick session={session} onComplete={(status) => {
      if (status === "approved" || status === "pending") {
        sessionStorage.setItem("curtiz-pending-order-cleanup", orderId);
      }
      window.location.assign(`/pedido/${encodeURIComponent(orderId)}/pagamento`);
    }} />
  </div>;
}
