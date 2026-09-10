"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import {
  createCheckoutPaymentPayload,
  createMercadoPagoInitialization,
  type MercadoPagoBrickSession
} from "@/lib/mercadopago-brick-config";

type PaymentState = "approved" | "pending" | "rejected" | "cancelled" | "error";
type BrickController = { unmount?: () => void | Promise<void> };
const BRICK_CONTAINER_ID = "mercadopago-payment-brick";
const BRICK_INITIALIZATION_TIMEOUT_MS = 15_000;
const BRICK_LOAD_ERROR = "Não foi possível carregar as formas de pagamento.";
type MercadoPagoConstructor = new (
  publicKey: string,
  options: { locale: string; deviceProfileCspNonce?: string }
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

export function MercadoPagoPaymentBrick({
  session,
  onComplete
}: {
  session: MercadoPagoBrickSession;
  onComplete: (status: PaymentState, orderCode: string) => void;
}) {
  const [sdkReady, setSdkReady] = useState(() => typeof window !== "undefined" && Boolean(window.MercadoPago));
  const [brickReady, setBrickReady] = useState(false);
  const [initializationFailed, setInitializationFailed] = useState(false);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [message, setMessage] = useState("");
  const controller = useRef<BrickController | null>(null);
  const initializationQueue = useRef<Promise<void>>(Promise.resolve());
  const completion = useRef(onComplete);
  completion.current = onComplete;

  useEffect(() => {
    if (sdkReady || initializationFailed) return;

    const timeout = window.setTimeout(() => {
      setInitializationFailed(true);
    }, BRICK_INITIALIZATION_TIMEOUT_MS);

    return () => window.clearTimeout(timeout);
  }, [sdkReady, initializationAttempt, initializationFailed]);

  useEffect(() => {
    if (!sdkReady || !window.MercadoPago) return;

    let active = true;
    const previousInitialization = initializationQueue.current.catch(() => undefined);
    const initialize = previousInitialization.then(async () => {
      if (!active || !window.MercadoPago) return;

      const container = document.getElementById(BRICK_CONTAINER_ID);
      if (!container) {
        setInitializationFailed(true);
        return;
      }

      const initialization = createMercadoPagoInitialization(session);
      if (!initialization) {
        console.error("[mercadopago-bricks] initialization rejected", { cause: "invalid_amount" });
        setInitializationFailed(true);
        return;
      }

      container.replaceChildren();
      const documentNonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce?.trim();
      const mercadoPago = new window.MercadoPago(session.publicKey, {
        locale: "pt-BR",
        ...(documentNonce ? { deviceProfileCspNonce: documentNonce } : {})
      });
      let initializationEnded = false;
      let resolveReady: (() => void) | undefined;
      let rejectReady: ((reason?: unknown) => void) | undefined;
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      let timeoutId: number | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error("brick_initialization_timeout")),
          BRICK_INITIALIZATION_TIMEOUT_MS
        );
      });

      const creation = mercadoPago.bricks().create("payment", BRICK_CONTAINER_ID, {
        initialization,
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
          onReady: () => resolveReady?.(),
          onSubmit: async ({ formData }: { formData: unknown }) => {
            setMessage("");
            const payment = createCheckoutPaymentPayload(formData, session);
            if (!payment) {
              setMessage("Revise os dados do pagamento.");
              throw new Error("invalid_payment_form_data");
            }
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
                  payment
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
          onError: (error: unknown) => {
            const safeError = error && typeof error === "object"
              ? {
                  cause: "cause" in error && typeof error.cause === "string" ? error.cause : "unknown",
                  message: "message" in error && typeof error.message === "string" ? error.message : undefined
                }
              : { cause: "unknown" };
            console.error("[mercadopago-bricks] initialization failed", safeError);
            rejectReady?.(new Error("brick_on_error"));
          }
        }
      }).then((created) => {
        if (!active || initializationEnded) void created.unmount?.();
        return created;
      });

      try {
        const [createdController] = await Promise.race([Promise.all([creation, ready]), timeout]);
        initializationEnded = true;
        if (!active) {
          void createdController.unmount?.();
          return;
        }
        controller.current = createdController;
        setInitializationFailed(false);
        setBrickReady(true);
      } catch {
        initializationEnded = true;
        void creation.then((createdController) => createdController.unmount?.(), () => undefined);
        if (active) {
          setBrickReady(false);
          setInitializationFailed(true);
        }
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      }
    });

    initializationQueue.current = initialize.catch((error: unknown) => {
      console.error("[mercadopago-bricks] initialization failed", {
        cause: error instanceof Error ? error.message : "unexpected_initialization_error"
      });
      if (active) {
        setBrickReady(false);
        setInitializationFailed(true);
      }
    });

    return () => {
      active = false;
      const current = controller.current;
      controller.current = null;
      void current?.unmount?.();
    };
  }, [sdkReady, session, initializationAttempt]);

  const retryInitialization = () => {
    const current = controller.current;
    controller.current = null;
    void current?.unmount?.();
    document.getElementById(BRICK_CONTAINER_ID)?.replaceChildren();
    setMessage("");
    setBrickReady(false);
    setInitializationFailed(false);
    setSdkReady(Boolean(window.MercadoPago));
    setInitializationAttempt((attempt) => attempt + 1);
  };

  return (
    <section className="checkout-section checkout-payment-brick" aria-labelledby="mercadopago-payment-title">
      <Script
        key={initializationAttempt}
        src="https://sdk.mercadopago.com/js/v2"
        strategy="afterInteractive"
        onReady={() => setSdkReady(true)}
        onLoad={() => setSdkReady(true)}
        onError={() => setInitializationFailed(true)}
      />
      <header>
        <div>
          <p className="eyebrow">Pagamento seguro</p>
          <h1 id="mercadopago-payment-title">Finalize seu pedido</h1>
        </div>
        <span className="checkout-test-badge"><ShieldCheck width={24} height={24} /> Ambiente de teste</span>
      </header>
      <p className="checkout-test-notice">Use somente dados de teste. Nenhuma cobrança real será realizada.</p>
      {!brickReady && !initializationFailed ? (
        <p className="checkout-simple-status" role="status"><LoaderCircle className="spin" width={24} height={24} /> Carregando formas de pagamento…</p>
      ) : null}
      <div
        id={BRICK_CONTAINER_ID}
        aria-busy={!brickReady && !initializationFailed}
        hidden={initializationFailed}
      />
      {initializationFailed ? (
        <>
          <p className="form-message" role="alert">{BRICK_LOAD_ERROR}</p>
          <button className="secondary-button compact-button" type="button" onClick={retryInitialization}>
            Tentar novamente
          </button>
        </>
      ) : null}
      {message ? <p className="form-message" role="alert">{message}</p> : null}
    </section>
  );
}
