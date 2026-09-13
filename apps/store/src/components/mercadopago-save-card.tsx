"use client";

import { useEffect, useRef, useState } from "react";
import type { MercadoPagoBrickSession } from "@/lib/mercadopago-brick-config";
import { isUnknownRecord } from "@/lib/unknown-data";

// A separate official Brick produces a fresh save-only token after approval.
// Its callback never invokes a payment endpoint and never keeps the card form data.
export function MercadoPagoSaveCard({ session, orderId, onDone }: {
  session: MercadoPagoBrickSession; orderId: string; onDone: () => void;
}) {
  const [message, setMessage] = useState("");
  const [processing, setProcessing] = useState(false);
  const [finished, setFinished] = useState(false);
  const [ready, setReady] = useState(false);
  const submitting = useRef(false);
  const key = useRef("");
  useEffect(() => {
    if (!window.MercadoPago) return;
    let active = true, controller: { unmount: () => unknown } | null = null;
    key.current ||= crypto.randomUUID();
    const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
    const provider = new window.MercadoPago(session.publicKey, { locale: "pt-BR", ...(nonce ? { deviceProfileCspNonce: nonce } : {}) });
    const timer = window.setTimeout(() => { if (active) { setMessage("Não foi possível carregar o salvamento do cartão. Sua compra está aprovada."); setFinished(true); } }, 15_000);
    void provider.bricks().create("cardPayment", "mercadopago-save-card", {
      initialization: { amount: session.amountInCents / 100, payer: { email: session.email } },
      customization: { visual: { texts: { formTitle: "Confirme o cartão para salvar", formSubmit: "Salvar cartão" } } },
      callbacks: {
        onReady: () => { window.clearTimeout(timer); if (active) setReady(true); },
        onError: () => { if (active) { setMessage("Não foi possível salvar o cartão. Sua compra está aprovada."); setFinished(true); } },
        onSubmit: async (data: unknown) => {
          if (submitting.current) throw new Error("card_save_in_progress");
          if (!isUnknownRecord(data) || typeof data.token !== "string") throw new Error("invalid_save_token");
          submitting.current = true;
          setProcessing(true);
          try {
            const response = await fetch("/api/customer/cards", { method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ orderId, key: key.current, consent: true, token: data.token }) });
            const result: unknown = await response.json();
            setMessage(response.ok && isUnknownRecord(result) && result.ok === true
              ? "Cartão salvo para suas próximas compras."
              : "Sua compra está aprovada, mas não foi possível confirmar o salvamento do cartão.");
          } catch { setMessage("Sua compra está aprovada, mas não foi possível confirmar o salvamento do cartão."); }
          finally { setProcessing(false); setFinished(true); }
        }
      }
    }).then(candidate => {
      if (candidate && typeof candidate === "object" && "unmount" in candidate && typeof candidate.unmount === "function") {
        controller = candidate as { unmount: () => unknown };
        if (!active) void Promise.resolve().then(() => controller?.unmount()).catch(() => undefined);
      }
    }).catch(() => { if (active) { setMessage("Não foi possível carregar o salvamento do cartão. Sua compra está aprovada."); setFinished(true); } });
    return () => { active = false; window.clearTimeout(timer); if (controller) void Promise.resolve().then(() => controller?.unmount()).catch(() => undefined); };
  }, [session, orderId]);
  return <section aria-labelledby="save-card-title">
    <h2 id="save-card-title">Pagamento aprovado</h2>
    <p>Para salvar seu cartão com segurança, confirme os dados abaixo. Isso não gera outra cobrança.</p>
    {!ready && !finished ? <p role="status">Carregando…</p> : null}
    <div id="mercadopago-save-card" inert={processing || finished} hidden={finished} aria-busy={processing} />
    {message ? <p role="status">{message}</p> : null}
    <button className="secondary-button" type="button" disabled={processing} onClick={onDone}>
      {finished ? "Continuar para o pedido" : "Continuar sem salvar"}
    </button>
  </section>;
}
