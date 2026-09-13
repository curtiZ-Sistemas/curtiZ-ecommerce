"use client";

import { LoaderCircle } from "lucide-react";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCheckoutPaymentPayload,
  createMercadoPagoInitialization,
  type MercadoPagoBrickSession
} from "@/lib/mercadopago-brick-config";
import { isUnknownRecord, readString } from "@/lib/unknown-data";

type PaymentState = "approved" | "pending" | "rejected" | "cancelled" | "error";
type BrickController = { unmount: () => void | Promise<void> };
const isBrickController = (value: unknown): value is BrickController =>
  Boolean(
    value &&
    typeof value === "object" &&
    "unmount" in value &&
    typeof value.unmount === "function"
  );
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
    ) => Promise<unknown>;
  };
};

declare global {
  interface Window {
    MercadoPago?: MercadoPagoConstructor;
  }
}

export function MercadoPagoPaymentBrick({
  session,
  onComplete,
  onReviewCheckout
}: {
  session: MercadoPagoBrickSession;
  onComplete: (status: PaymentState, orderCode: string, orderId: string) => void;
  onReviewCheckout?: (message: string, code: string) => void;
}) {
  const [sdkReady, setSdkReady] = useState(() => typeof window !== "undefined" && Boolean(window.MercadoPago));
  const [brickReady, setBrickReady] = useState(false);
  const [initializationFailed, setInitializationFailed] = useState(false);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [message, setMessage] = useState("");
  const [processing, setProcessing] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryOrderId, setRecoveryOrderId] = useState("");
  const submitting = useRef(false);
  const attempt = useRef<{ key: string; orderId: string; orderCode: string; body: string | null } | null>(null);
  const controller = useRef<BrickController | null>(null);
  const initializationQueue = useRef<Promise<void>>(Promise.resolve());
  const disposedControllers = useRef(new WeakSet<object>());
  const completion = useRef(onComplete);
  completion.current = onComplete;
  const reviewCheckout = useRef(onReviewCheckout);
  reviewCheckout.current = onReviewCheckout;

  const persistAttempt = useCallback(() => {
    if (!attempt.current) return;
    const { key, orderId, orderCode } = attempt.current;
    try {
      const metadata = JSON.stringify({ key, orderId, orderCode });
      sessionStorage.setItem(`curtiz-payment-attempt:${session.orderId || session.idempotencyKey}`, metadata);
      if (orderId) sessionStorage.setItem(`curtiz-payment-attempt:${orderId}`, metadata);
    } catch { /* In-memory idempotency still protects retries when browser storage is unavailable. */ }
  }, [session.orderId, session.idempotencyKey]);

  const disposeController = useCallback((candidate: unknown) => {
    if (
      !isBrickController(candidate) ||
      disposedControllers.current.has(candidate)
    ) return Promise.resolve();

    disposedControllers.current.add(candidate);
    return Promise.resolve().then(() => candidate.unmount()).catch((error: unknown) => {
      console.error("[mercadopago-bricks] cleanup failed", {
        cause: error instanceof Error ? error.message : "unexpected_cleanup_error"
      });
    });
  }, []);

  const queueDisposal = useCallback((candidate: unknown) => {
    initializationQueue.current = initializationQueue.current
      .catch(() => undefined)
      .then(() => disposeController(candidate));
  }, [disposeController]);

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

      if (!attempt.current) {
        attempt.current = { key: crypto.randomUUID(), orderId: session.orderId, orderCode: session.orderCode, body: null };
        try {
          const stored: unknown = JSON.parse(sessionStorage.getItem(`curtiz-payment-attempt:${session.orderId || session.idempotencyKey}`) ?? "null");
          const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
          if (isUnknownRecord(stored) && uuid.test(readString(stored, "key")) &&
            (!session.orderId || readString(stored, "orderId") === session.orderId)) {
            attempt.current.key = readString(stored, "key");
            const storedOrder = readString(stored, "orderId");
            if (uuid.test(storedOrder)) attempt.current.orderId = storedOrder;
            attempt.current.orderCode = readString(stored, "orderCode");
          }
        } catch { /* Corrupt metadata is never used as payment data. */ }
        persistAttempt();
      }

      const container = document.getElementById(BRICK_CONTAINER_ID);
      if (!container) {
        if (active) setInitializationFailed(true);
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
            if (submitting.current) throw new Error("payment_submission_in_progress");
            submitting.current = true;
            setProcessing(true);
            setMessage("");
            try {
              const current = attempt.current;
              if (!current) throw new Error("payment_attempt_unavailable");
              if (!current.body) {
                const payment = createCheckoutPaymentPayload(formData, session);
                if (!payment) {
                  setMessage("Revise o documento do pagador e os dados do pagamento.");
                  throw new Error("invalid_payment_form_data");
                }
                // Cache only in memory: a transport retry must send the same token and payer.
                current.body = JSON.stringify({
                  ...(current.orderId ? { orderId: current.orderId } : { checkout: session.checkout }),
                  checkoutIdempotencyKey: session.idempotencyKey,
                  idempotencyKey: current.key,
                  payment
                });
              }
              const paymentResponse = await fetch("/api/checkout/payment", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: current.body
              });
              const payload: unknown = await paymentResponse.json();
              if (!isUnknownRecord(payload)) throw new Error("invalid_payment_response");
              const resultOrderId = readString(payload, "orderId");
              const resultOrderCode = readString(payload, "orderCode");
              const resultRecovery = readString(payload, "recovery");
              const resultStatus = readString(payload, "status");
              const resultMessage = readString(payload, "message") || "Não foi possível processar o pagamento agora.";
              setRecovery(resultRecovery);
              setRecoveryCode(readString(payload, "code"));
              setRecoveryOrderId(resultOrderId || current.orderId);
              if (resultOrderId && readString(payload, "code") !== "CHECKOUT_IDEMPOTENCY_CONFLICT") {
                current.orderId = resultOrderId;
                current.orderCode = resultOrderCode || current.orderCode;
                persistAttempt();
              }
              if (paymentResponse.ok && payload.ok === true &&
                (resultStatus === "approved" || resultStatus === "pending" || resultStatus === "cancelled")) {
                try {
                  sessionStorage.removeItem(`curtiz-payment-attempt:${session.orderId || session.idempotencyKey}`);
                  if (current.orderId) sessionStorage.removeItem(`curtiz-payment-attempt:${current.orderId}`);
                } catch { /* Terminal status is also enforced by the server. */ }
                completion.current(resultStatus, current.orderCode, current.orderId);
                return;
              }
              if (resultRecovery === "new_attempt" || resultRecovery === "review_checkout" ||
                (paymentResponse.ok && resultStatus === "rejected")) {
                current.key = crypto.randomUUID();
                current.body = null;
                persistAttempt();
              }
              setMessage(resultMessage);
              throw new Error("payment_not_completed");
            } catch (error) {
              setMessage((currentMessage) => currentMessage ||
                "O resultado da tentativa ainda não foi confirmado. Tente novamente para verificar o mesmo pagamento.");
              throw error;
            } finally {
              submitting.current = false;
              setProcessing(false);
            }
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
      });

      void creation.then((createdController) => {
        if (!active || initializationEnded) queueDisposal(createdController);
      }, () => undefined);

      try {
        const [createdController] = await Promise.race([Promise.all([creation, ready]), timeout]);
        initializationEnded = true;
        if (!isBrickController(createdController)) throw new Error("invalid_brick_controller");
        if (!active) {
          queueDisposal(createdController);
          return;
        }
        controller.current = createdController;
        setInitializationFailed(false);
        setBrickReady(true);
      } catch {
        initializationEnded = true;
        void creation.then((createdController) => queueDisposal(createdController), () => undefined);
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
      queueDisposal(current);
    };
  }, [sdkReady, session, initializationAttempt, queueDisposal, persistAttempt]);

  const retryInitialization = () => {
    const current = controller.current;
    controller.current = null;
    queueDisposal(current);
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
      </header>
      {!brickReady && !initializationFailed ? (
        <p className="checkout-simple-status" role="status"><LoaderCircle className="spin" width={24} height={24} /> Carregando formas de pagamento…</p>
      ) : null}
      <div
        id={BRICK_CONTAINER_ID}
        aria-busy={processing || (!brickReady && !initializationFailed)}
        inert={processing}
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
      {processing ? <p role="status">Processando pagamento…</p> : null}
      {recovery === "review_checkout" && reviewCheckout.current ? (
        <button className="secondary-button compact-button" type="button" disabled={processing}
          onClick={() => reviewCheckout.current?.(message, recoveryCode)}>Revisar checkout</button>
      ) : null}
      {recoveryOrderId && (recovery === "view_order" || recovery === "retry_attempt") ? (
        <a className="secondary-button compact-button" href={`/pedido/${encodeURIComponent(recoveryOrderId)}/pagamento`}>
          Acompanhar pagamento do pedido
        </a>
      ) : null}
    </section>
  );
}
