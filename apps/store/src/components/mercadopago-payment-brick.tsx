"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type PaymentState = "approved" | "pending" | "rejected" | "cancelled" | "error";
type BrickController = { unmount?: () => void | Promise<void> };
type MercadoPagoConstructor = new (
  publicKey: string,
  options: { locale: string }
) => {
  bricks: () => {
    create: (
      type: "payment",
      containerId: string,
      settings: Record<string, unknown>
    ) => Promise<BrickController>;
  };
};

declare global {
  interface Window {
    MercadoPago?: MercadoPagoConstructor;
  }
}

export type MercadoPagoBrickSession = {
  orderId: string;
  orderCode: string;
  subtotalInCents: number;
  shippingInCents: number;
  amountInCents: number;
  publicKey: string;
  idempotencyKey: string;
  email: string;
  cpf: string;
};

export function MercadoPagoPaymentBrick({
  session,
  onComplete
}: {
  session: MercadoPagoBrickSession;
  onComplete: (status: PaymentState, orderCode: string) => void;
}) {
  const [sdkReady, setSdkReady] = useState(() => typeof window !== "undefined" && Boolean(window.MercadoPago));
  const [brickReady, setBrickReady] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<BrickController | null>(null);
  const completion = useRef(onComplete);
  completion.current = onComplete;

  useEffect(() => {
    if (!sdkReady || !window.MercadoPago || controller.current) return;
    let active = true;
    const mercadoPago = new window.MercadoPago(session.publicKey, { locale: "pt-BR" });
    void mercadoPago.bricks().create("payment", "mercadopago-payment-brick", {
      initialization: {
        amount: session.amountInCents / 100,
        payer: {
          email: session.email,
          identification: { type: "CPF", number: session.cpf }
        }
      },
      customization: {
        paymentMethods: {
          creditCard: "all",
          debitCard: "all",
          bankTransfer: "all",
          ticket: "all"
        },
        visual: { style: { theme: "default" } }
      },
      callbacks: {
        onReady: () => {
          if (active) setBrickReady(true);
        },
        onSubmit: async ({ formData }: { formData: unknown }) => {
          setMessage("");
          let result: {
            ok?: boolean;
            status?: PaymentState;
            orderCode?: string;
            message?: string;
          };
          try {
            const paymentResponse = await fetch("/api/checkout/payment", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                orderId: session.orderId,
                idempotencyKey: session.idempotencyKey,
                payment: formData
              })
            });
            result = await paymentResponse.json() as typeof result;
          } catch {
            setMessage("Não foi possível processar o pagamento agora.");
            throw new Error("payment_request_failed");
          }
          if (result.status && ["approved", "pending", "rejected", "cancelled"].includes(result.status)) {
            completion.current(result.status, result.orderCode ?? session.orderCode);
            return;
          }
          setMessage(result.message ?? "Não foi possível processar o pagamento agora.");
          throw new Error("payment_not_completed");
        },
        onError: () => {
          if (active) setMessage("Não foi possível carregar o pagamento. Tente novamente.");
        }
      }
    }).then((createdController) => {
      if (active) controller.current = createdController;
      else void createdController.unmount?.();
    }).catch(() => {
      if (active) setMessage("Não foi possível carregar o pagamento. Tente novamente.");
    });

    return () => {
      active = false;
      const current = controller.current;
      controller.current = null;
      void current?.unmount?.();
    };
  }, [sdkReady, session]);

  return (
    <section className="checkout-section checkout-payment-brick" aria-labelledby="mercadopago-payment-title">
      <Script
        src="https://sdk.mercadopago.com/js/v2"
        strategy="afterInteractive"
        onLoad={() => setSdkReady(true)}
        onError={() => setMessage("Não foi possível carregar o pagamento. Tente novamente.")}
      />
      <header>
        <div>
          <p className="eyebrow">Pagamento seguro</p>
          <h1 id="mercadopago-payment-title">Finalize seu pedido</h1>
        </div>
        <span className="checkout-test-badge"><ShieldCheck /> Ambiente de teste</span>
      </header>
      <p className="checkout-test-notice">Use somente dados de teste. Nenhuma cobrança real será realizada.</p>
      {!brickReady && !message ? (
        <p className="checkout-simple-status" role="status"><LoaderCircle className="spin" /> Carregando formas de pagamento…</p>
      ) : null}
      <div id="mercadopago-payment-brick" aria-busy={!brickReady} />
      {message ? <p className="form-message" role="alert">{message}</p> : null}
    </section>
  );
}
