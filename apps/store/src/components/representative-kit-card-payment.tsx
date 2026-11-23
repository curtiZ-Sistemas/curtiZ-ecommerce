"use client";

import { LoaderCircle } from "lucide-react";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { createCheckoutPaymentPayload, createMercadoPagoInitialization } from "../lib/mercadopago-brick-config";
import { isUnknownRecord, readNumber, readString, type UnknownRecord } from "../lib/unknown-data";
import { kitRequest } from "./representative-kit-request";

export type KitCardKind = "credit" | "debit";
const containerPrefix = "kit-card-brick-";
const initializationTimeoutMs = 15_000;

type BrickController = { unmount: () => unknown };
const isController = (value: unknown): value is BrickController =>
  isUnknownRecord(value) && typeof value.unmount === "function";

// The same Mercado Pago Payment Brick and SDK as the store checkout. Only the token and the
// choices made in the form leave the browser; amount, payer and document come from the server.
export function RepresentativeKitCardPayment({ orderId, kind, onResult }: {
  orderId: string; kind: KitCardKind; onResult: (result: UnknownRecord) => void;
}) {
  const [session, setSession] = useState<{ publicKey: string; amountInCents: number; email: string } | null>(null);
  const [sdkReady, setSdkReady] = useState(() => typeof window !== "undefined" && Boolean(window.MercadoPago));
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const result = useRef(onResult);
  result.current = onResult;
  const containerId = `${containerPrefix}${orderId}`;

  useEffect(() => {
    let active = true;
    setSession(null);
    setFailed(false);
    void kitRequest({ action: "card_session", orderId }).then(data => {
      const value = isUnknownRecord(data.session) ? data.session : null;
      const publicKey = value ? readString(value, "publicKey") : "";
      const amountInCents = value ? readNumber(value, "amountInCents") : 0;
      const email = value ? readString(value, "email") : "";
      if (!active) return;
      if (!publicKey || amountInCents <= 0 || !email) throw new Error("card_session_invalid");
      setSession({ publicKey, amountInCents, email });
    }).catch(failure => {
      if (!active) return;
      setFailed(true);
      setMessage(failure instanceof Error && failure.message !== "card_session_invalid" ? failure.message
        : "Não foi possível carregar o pagamento com cartão.");
    });
    return () => { active = false; };
  }, [orderId, attempt]);

  useEffect(() => {
    if (!session || !sdkReady || !window.MercadoPago) return;
    const initialization = createMercadoPagoInitialization({ amountInCents: session.amountInCents, email: session.email });
    const container = document.getElementById(containerId);
    if (!initialization || !container) { setFailed(true); return; }
    let active = true;
    let controller: unknown = null;
    container.replaceChildren();
    const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce?.trim();
    const mercadoPago = new window.MercadoPago(session.publicKey, { locale: "pt-BR", ...(nonce ? { deviceProfileCspNonce: nonce } : {}) });
    let markReady: (() => void) | undefined;
    const readyPromise = new Promise<void>(resolve => { markReady = resolve; });
    const creation = mercadoPago.bricks().create("payment", containerId, {
      initialization,
      customization: {
        paymentMethods: kind === "credit" ? { creditCard: "all" } : { debitCard: "all" },
        visual: { style: { theme: "default" } }
      },
      callbacks: {
        onReady: () => markReady?.(),
        onSubmit: async ({ formData }: { formData: unknown }) => {
          if (submitting.current) throw new Error("payment_submission_in_progress");
          submitting.current = true;
          setProcessing(true);
          setMessage("");
          try {
            const payment = createCheckoutPaymentPayload(formData, { paymentMode: "production" });
            if (!payment || !payment.token) {
              setMessage("Revise os dados do cartão e tente novamente.");
              throw new Error("invalid_payment_form_data");
            }
            const data = await kitRequest({
              action: "card", orderId,
              payment: { kind, token: payment.token, payment_method_id: payment.payment_method_id,
                installments: payment.installments, ...(payment.issuer_id !== undefined ? { issuer_id: payment.issuer_id } : {}) }
            });
            const card = isUnknownRecord(data.card) ? data.card : {};
            const status = readString(card, "status");
            if (status === "rejected" || status === "declined") {
              setMessage(readString(card, "message") || "Pagamento recusado. Confira os dados ou use outro cartão e tente novamente.");
              throw new Error("payment_refused");
            }
            result.current(data);
          } catch (failure) {
            // A refused card keeps the form open for another attempt.
            setMessage(current => current || (failure instanceof Error && failure.message
              ? failure.message : "O resultado ainda não foi confirmado. Use Atualizar situação antes de tentar novamente."));
            throw failure;
          } finally {
            submitting.current = false;
            setProcessing(false);
          }
        },
        onError: () => { markReady?.(); if (active) setFailed(true); }
      }
    });
    const timeout = window.setTimeout(() => { if (active) setFailed(true); }, initializationTimeoutMs);
    void Promise.all([creation, readyPromise]).then(([created]) => {
      window.clearTimeout(timeout);
      controller = created;
      if (!active) { if (isController(created)) void Promise.resolve(created.unmount()).catch(() => undefined); return; }
      setReady(true);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (isController(controller)) void Promise.resolve(controller.unmount()).catch(() => undefined);
      else void creation.then(created => isController(created) ? created.unmount() : undefined).catch(() => undefined);
    };
  }, [session, sdkReady, kind, containerId, orderId]);

  return <section className="checkout-payment-brick kit-card-payment"
    aria-label={kind === "credit" ? "Cartão de crédito" : "Cartão de débito"}>
    <Script src="https://sdk.mercadopago.com/js/v2" strategy="afterInteractive"
      onReady={() => setSdkReady(true)} onLoad={() => setSdkReady(true)} onError={() => setFailed(true)} />
    {!ready && !failed && <p className="checkout-simple-status" role="status">
      <LoaderCircle className="spin" width={24} height={24} /> Carregando o pagamento com cartão…</p>}
    <div id={containerId} aria-busy={processing || (!ready && !failed)} inert={processing} hidden={failed} />
    {failed && <button type="button" className="secondary-button compact-button" onClick={() => {
      setReady(false); setFailed(false); setMessage(""); setAttempt(value => value + 1);
      setSdkReady(Boolean(window.MercadoPago));
    }}>Tentar novamente</button>}
    {message && <p className="form-message" role="alert">{message}</p>}
    {processing && <p role="status">Processando pagamento…</p>}
  </section>;
}
