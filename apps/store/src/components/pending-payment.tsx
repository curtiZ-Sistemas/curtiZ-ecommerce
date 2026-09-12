"use client";

import { Check, Circle, Clock3, Copy, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatBRL } from "@curtiz/domain";
import { useCart } from "@/components/cart-provider";

type State = { orderCode: string; orderStatus: string; status: string; method: string; amountInCents: number;
  expiresAt: string; pixCopyPaste: string; pixQrCodeBase64: string; boletoUrl: string; digitableLine: string; variantIds: string[] };
const terminal = new Set(["approved", "rejected", "expired", "cancelled", "refunded", "charged_back"]);

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
        if (!response.ok) throw new Error(result.message);
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
  }, [orderId]);
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
  const failed = state ? ["rejected", "expired", "cancelled", "refunded", "charged_back"].includes(state.status) : false;
  const title = approved ? "Pagamento aprovado"
    : expired ? "Pagamento expirado"
      : state?.status === "refunded" ? "Pagamento reembolsado"
        : state?.status === "charged_back" ? "Pagamento contestado"
          : failed ? "Pagamento não aprovado" : "Processando pagamento";
  const pix = state?.method.includes("pix");
  const boleto = state?.method.includes("ticket") || state?.method.includes("bol");
  const progress = state?.orderStatus === "delivered" ? 4
    : state?.orderStatus === "shipped" ? 3
      : state && ["processing", "picking", "ready_to_ship"].includes(state.orderStatus) ? 2
        : approved ? 1 : 0;
  const remainingSeconds = state?.expiresAt
    ? Math.max(0, Math.floor((new Date(state.expiresAt).getTime() - now) / 1_000)) : 0;
  const countdown = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Código copiado.");
    } catch {
      setMessage("Não foi possível copiar. Selecione o código manualmente.");
    }
  };
  return <div className="container page-shell pending-payment-page">
    <header><p className="eyebrow">Pedido {state?.orderCode ?? ""}</p><h1>{title}</h1></header>
    {!failed ? <ol className="order-progress" aria-label="Andamento do pedido">
      {["Pedido realizado", approved ? "Pagamento confirmado" : "Processando pagamento", "Preparando pedido", "Enviado", "Entregue"].map((label, index) =>
        <li className={index <= progress ? "complete" : index === progress + 1 ? "active" : ""} key={label}>
          {index <= progress ? <Check aria-hidden="true" /> : index === progress + 1 ? <Clock3 aria-hidden="true" /> : <Circle aria-hidden="true" />}<span>{label}</span>
        </li>)}
    </ol> : null}
    {state && !approved && !failed && <section className="checkout-section pending-payment-details">
      <h2>{pix ? "Aguardando pagamento via Pix" : boleto ? "Aguardando pagamento do boleto" : "Pagamento em análise"}</h2>
      {pix && state.pixQrCodeBase64 ? <Image unoptimized src={`data:image/png;base64,${state.pixQrCodeBase64}`} width={240} height={240} alt="QR Code Pix deste pedido" /> : null}
      {pix && state.pixCopyPaste ? <button className="primary-button" type="button" onClick={() => void copy(state.pixCopyPaste)}><Copy aria-hidden="true" /> Copiar Pix Copia e Cola</button> : null}
      {boleto && state.boletoUrl ? <a className="primary-button" href={state.boletoUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" /> Abrir boleto</a> : null}
      {boleto && state.digitableLine ? <button className="secondary-button" type="button" onClick={() => void copy(state.digitableLine)}><Copy aria-hidden="true" /> Copiar linha digitável</button> : null}
      {state.expiresAt ? <p>Vencimento: <strong>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(state.expiresAt))}</strong><br />
        {remainingSeconds > 0 ? <>Expira em {countdown}</> : <>Prazo encerrado</>}</p> : null}
      <p>Valor: <strong>{formatBRL(state.amountInCents)}</strong></p>
    </section>}
    {message ? <p className="form-message" role="status">{message}</p> : null}
    <div className="customer-form-actions"><Link className="secondary-button" href="/minha-conta/pedidos">Acompanhar pedidos</Link>{["rejected", "expired", "cancelled"].includes(state?.status ?? "") ? <Link className="primary-button" href={expired || state?.status === "cancelled" ? "/checkout" : `/pedido/${encodeURIComponent(orderId)}/pagamento?retry=1`}>Tentar outro meio de pagamento</Link> : null}</div>
  </div>;
}
