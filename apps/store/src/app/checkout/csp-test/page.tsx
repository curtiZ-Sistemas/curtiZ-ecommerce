"use client";

import { MercadoPagoPaymentBrick } from "@/components/mercadopago-payment-brick";

export default function CheckoutCspTestPage() {
  const publicKey = process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim() ?? "";

  if (!publicKey.startsWith("TEST-")) return <p data-testid="missing-test-key">Credencial de teste indisponível.</p>;

  return (
    <main className="container page-shell checkout-page checkout-bricks-page">
      <MercadoPagoPaymentBrick
        session={{
          orderId: "csp-test",
          orderCode: "CSP-TEST",
          subtotalInCents: 2_550,
          shippingInCents: 1_690,
          amountInCents: 4_240,
          publicKey,
          idempotencyKey: "csp-test",
          email: "test_user_123456@testuser.com",
          cpf: "19119119100"
        }}
        onComplete={() => undefined}
      />
    </main>
  );
}
