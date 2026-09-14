"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatBRL } from "@curtiz/domain";
import { useCart } from "@/components/cart-provider";

type State = { orderCode: string; orderStatus: string; status: string; method: string; amountInCents: number;
  expiresAt: string; pixCopyPaste: string; pixQrCodeBase64: string; boletoUrl: string; digitableLine: string; variantIds: string[] };
const terminal = new Set(["approved", "rejected", "expired", "cancelled", "refunded", "charged_back", "unavailable"]);

export function PendingPayment({ orderId }: { orderId: string }) {
  const { removeMany } = useCart();
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/payment`, { cache: "no-store" });
        const result = await response.json() as State & { message?: string };
        if (!response.ok && !(response.status === 409 && result.orderCode)) throw new Error(result.message);
        if (!active) return;
        setState(result);
        setMessage("");
        if (!terminal.has(result.status)) timer = window.setTimeout(() => void load(), 8_000);
      } catch {
        if (active) { setMessage("Não foi possível consultar o pagamento agora. Tente novamente."); timer = window.setTimeout(() => void load(), 15_000); }
      }
    };
    void load();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [orderId, removeMany]);
  useEffect(() => {
    if (!state || sessionStorage.getItem("curtiz-pending-order-cleanup") !== orderId) return;
    if (state.status === "approved" && state.variantIds.length) {
      removeMany(state.variantIds);
      sessionStorage.removeItem("curtiz-pending-order-cleanup");
    } else if (["rejected", "expired", "cancelled", "refunded", "charged_back"].includes(state.status)) {
      sessionStorage.removeItem("curtiz-pending-order-cleanup");
    }
  }, [orderId, removeMany, state]);
  useEffect(() => {
    if (!state?.expiresAt || terminal.has(state.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [state?.expiresAt, state?.status]);
  const approved = state?.status === "approved";
  const expired = state?.status === "expired";
  const failed = state ? ["rejected", "expired", "cancelled", "refunded", "charged_back", "unavailable"].includes(state.status) : false;
  const title = approved ? "Pagamento confirmado"
    : expired ? "Pagamento expirado"
      : state?.status === "refunded" ? "Pagamento reembolsado"
        : state?.status === "charged_back" ? "Pagamento contestado"
          : state?.status === "unavailable" ? "Pagamento indisponível para este pedido"
            : failed ? "Pagamento não aprovado" : "Aguardando pagamento";
  const pix = state?.method.includes("pix");
  const boleto = state?.method.includes("ticket") || state?.method.includes("bol");
  const activeStep = state?.orderStatus === "delivered" ? 5
    : state?.orderStatus === "shipped" ? 4
      : approved || (state && ["payment_approved", "processing", "picking", "ready_to_ship"].includes(state.orderStatus)) ? 2 : 1;
  const remainingSeconds = state?.expiresAt
    ? Math.max(0, Math.floor((new Date(state.expiresAt).getTime() - now) / 1_000)) : 0;
  const countdown = remainingSeconds >= 60 ? `${Math.ceil(remainingSeconds / 60)} min` : `${remainingSeconds} s`;
  const expiration = state?.expiresAt ? new Date(state.expiresAt) : null;
  const expirationLabel = expiration && Number.isFinite(expiration.getTime())
    ? `${expiration.toLocaleDateString("pt-BR")} às ${expiration.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "";
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Código copiado.");
    } catch {
      setMessage("Não foi possível copiar. Selecione o código manualmente.");
    }
  };
  return <div className="container page-shell pending-payment-page">
    <header><h1>Pedido {state?.orderCode ?? ""}</h1><p role="status">{state ? title : "Consultando pagamento…"}</p></header>
    {state && !failed ? <ol className="order-progress" aria-label="Andamento do pedido">
      {["Pedido realizado", "Pagamento", "Preparando", "Enviado", "Entregue"].map((label, index) =>
        <li className={index < activeStep ? "complete" : index === activeStep ? "active" : ""}
          aria-current={index === activeStep ? "step" : undefined} key={label}>
          <span className="order-progress-marker">{index < activeStep ? <Check aria-hidden="true" /> : <span aria-hidden="true">{index + 1}</span>}</span>
          <span>{label}<span className="sr-only">{index < activeStep ? ": concluído" : index === activeStep ? ": em andamento" : ": próximo"}</span></span>
        </li>)}
    </ol> : null}
    {state && <div className="pending-payment-layout">
    <section className="pending-payment-details" aria-label="Pagamento">
      {approved ? <div className="payment-confirmed"><Check aria-hidden="true" /><h2>Pagamento confirmado</h2><p>Recebemos seu pagamento. Acompanhe as próximas etapas do pedido.</p></div>
        : failed ? <div><h2>{title}</h2><p>Consulte os detalhes do pedido para acompanhar este status.</p></div>
          : <>
      <div><h2>{pix ? "Pagamento via Pix" : boleto ? "Pagamento via boleto" : "Pagamento em análise"}</h2><p>Aguardando pagamento</p></div>
      {pix && state.pixQrCodeBase64 ? <Image unoptimized src={`data:image/png;base64,${state.pixQrCodeBase64}`} width={240} height={240} alt="QR Code Pix deste pedido" /> : null}
      {pix && state.pixCopyPaste ? <><button className="primary-button" type="button" onClick={() => void copy(state.pixCopyPaste)}><Copy aria-hidden="true" /> Copiar código Pix</button>
        <details className="pix-manual-copy"><summary>Ver código para copiar manualmente</summary><textarea readOnly aria-label="Código Pix" value={state.pixCopyPaste} /></details></> : null}
      {boleto && state.boletoUrl ? <a className="primary-button" href={state.boletoUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" /> Abrir boleto</a> : null}
      {boleto && state.digitableLine ? <button className="secondary-button" type="button" onClick={() => void copy(state.digitableLine)}><Copy aria-hidden="true" /> Copiar linha digitável</button> : null}
      <strong className="pending-payment-amount">{formatBRL(state.amountInCents)}</strong>
      {expirationLabel ? <div className="pending-payment-expiration"><strong>{remainingSeconds > 0 ? `Expira em ${countdown}` : "Prazo encerrado"}</strong>
        <p>Vencimento: {expirationLabel}</p></div> : null}
      </>}
    </section>
    <aside className="pending-payment-summary" aria-label="Resumo do pedido"><h2>Resumo do pedido</h2>
      <dl><div><dt>Pedido</dt><dd>{state.orderCode}</dd></div><div><dt>Pagamento</dt><dd>{pix ? "Pix" : boleto ? "Boleto" : "Cartão"}</dd></div>
        <div><dt>Status</dt><dd>{title}</dd></div><div className="payment-summary-total"><dt>Total</dt><dd>{formatBRL(state.amountInCents)}</dd></div></dl>
      <Link href={`/minha-conta/pedidos?pedido=${encodeURIComponent(state.orderCode)}`}>Ver detalhes do pedido</Link>
    </aside></div>}
    {message ? <p className="form-message" role="status">{message}</p> : null}
    <div className="customer-form-actions"><Link className="secondary-button" href="/minha-conta/pedidos">Acompanhar pedidos</Link></div>
  </div>;
}
