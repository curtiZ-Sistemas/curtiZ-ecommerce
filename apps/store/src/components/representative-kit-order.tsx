"use client";

import { formatBRL } from "@curtiz/domain";
import { useRef, useState, type FormEvent } from "react";
import { isUnknownRecord, readRows, readString, type UnknownRecord } from "../lib/unknown-data";

const statusLabels: Record<string, string> = {
  reserved: "Estoque reservado", payment_pending: "Aguardando pagamento",
  paid: "Pagamento confirmado", cancelled: "Cancelado", refunded: "Estornado",
  manual_review: "Em análise"
};
const shipmentLabels: Record<string, string> = {
  pending: "Envio em preparação", ready: "Envio em preparação", label_created: "Etiqueta gerada",
  dispatched: "Enviado", in_transit: "Em transporte", delayed: "Entrega com atraso",
  delivered: "Entregue", returned: "Devolvido ao remetente", cancelled: "Envio cancelado"
};

async function kitRequest(body: UnknownRecord) {
  const response = await fetch("/api/representatives/kits/orders", {
    method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const data: unknown = await response.json();
  if (!response.ok || !isUnknownRecord(data) || data.ok !== true) {
    throw new Error(isUnknownRecord(data) ? readString(data, "message", "Operação indisponível.") : "Operação indisponível.");
  }
  return data;
}

export function ReserveRepresentativeKit({ variantId, quantity, quoteId, addressId, totalInCents }: {
  variantId: string; quantity: number; quoteId: string; addressId: string; totalInCents: number;
}) {
  const requestKey = useRef("");
  const [order, setOrder] = useState<UnknownRecord | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  async function reserve() {
    if (waiting) return;
    setWaiting(true);
    setError("");
    requestKey.current ||= crypto.randomUUID();
    try {
      const data = await kitRequest({ action: "reserve", variantId, quantity, quoteId, addressId,
        idempotencyKey: requestKey.current });
      if (!isUnknownRecord(data.order)) throw new Error("Pedido indisponível para consulta.");
      setOrder(data.order);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível reservar o kit.");
    } finally {
      setWaiting(false);
    }
  }
  return order ? <RepresentativeKitOrder initial={order} checkoutConfigured /> : <>
    <p>Total com frete <strong>{formatBRL(totalInCents)}</strong></p>
    <button type="button" className="primary-button" disabled={waiting} onClick={() => void reserve()}>
      {waiting ? "Reservando…" : "Reservar kit"}
    </button>
    {error && <p role="alert">{error}</p>}
  </>;
}

function RepresentativeKitOrder({ initial, checkoutConfigured }: { initial: UnknownRecord; checkoutConfigured: boolean }) {
  const [order, setOrder] = useState(initial);
  const [tracking, setTracking] = useState<UnknownRecord | null>(null);
  const [returns, setReturns] = useState<UnknownRecord[]>([]);
  const [returnForm, setReturnForm] = useState(false);
  const returnKey = useRef("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const orderId = readString(order, "orderId");
  const state = readString(order, "state");
  const canCancel = (["reserved", "payment_pending"].includes(state) || order.canCancelPaid === true)
    && order.cancellationRequested !== true;
  const pix = isUnknownRecord(order.pix) ? readString(order.pix, "copyPaste") : "";
  async function update(action: "pix" | "status" | "cancel") {
    if (pending) return;
    setPending(true);
    setMessage("");
    setCopied(false);
    try {
      const data = await kitRequest({ action, orderId });
      if (!isUnknownRecord(data.order)) throw new Error("Pedido indisponível para consulta.");
      const next = data.order;
      setOrder(current => ({ ...current, ...next, pix: next.pix }));
      if (action === "status") {
        setTracking(isUnknownRecord(data.tracking) ? data.tracking : null);
        setReturns(readRows(data.returns));
      }
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Não foi possível consultar o pedido.");
    } finally {
      setPending(false);
    }
  }
  async function requestReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (pending) return;
    setPending(true);
    setMessage("");
    returnKey.current ||= crypto.randomUUID();
    try {
      const data = await kitRequest({ action: "return", orderId, quantity: Number(form.get("quantity")),
        reason: form.get("reason"), idempotencyKey: returnKey.current });
      if (!isUnknownRecord(data.request)) throw new Error("Solicitação indisponível.");
      const requested = data.request;
      setReturns(current => [requested,...current.filter(item => item.id !== requested.id)]);
      returnKey.current = "";
      setReturnForm(false);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Não foi possível solicitar a devolução.");
    } finally {
      setPending(false);
    }
  }
  const trackingCode = tracking ? readString(tracking, "trackingCode") : "";
  const shipmentStatus = tracking ? shipmentLabels[readString(tracking, "status")] : "";
  return <div className="representative-profile-form">
    {typeof order.productName === "string" && <strong>{order.productName}</strong>}
    <p role="status">{order.cancellationRequested === true && ["reserved", "payment_pending", "paid", "manual_review"].includes(state)
      ? "Cancelamento em confirmação" : statusLabels[state] ?? "Pedido em análise"}</p>
    {typeof order.amountInCents === "number" && <p>Total {formatBRL(order.amountInCents)}</p>}
    {pix && <>
      <label>Pix copia e cola<input readOnly value={pix} onFocus={event => event.currentTarget.select()} /></label>
      <button type="button" className="secondary-button" onClick={() => {
        const copy = navigator.clipboard?.writeText(pix);
        if (!copy) setMessage("Selecione e copie o código Pix.");
        else void copy.then(() => setCopied(true)).catch(() => setMessage("Selecione e copie o código Pix."));
      }}>{copied ? "Código copiado" : "Copiar código Pix"}</button>
    </>}
    {state === "reserved" && checkoutConfigured && canCancel && <button type="button" className="primary-button"
      disabled={pending} onClick={() => void update("pix")}>Gerar Pix</button>}
    <button type="button" className="secondary-button" disabled={pending}
      onClick={() => void update("status")}>{pending ? "Consultando…" : "Atualizar situação"}</button>
    {canCancel && <button type="button" className="secondary-button" disabled={pending}
      onClick={() => void update("cancel")}>Cancelar pedido</button>}
    {shipmentStatus && <p role="status">{shipmentStatus}{trackingCode && <> · Rastreio {trackingCode}</>}</p>}
    {(tracking?.status === "delivered" || tracking?.status === "returned") && ["paid","manual_review"].includes(state) &&
      <button type="button" className="secondary-button" aria-expanded={returnForm}
        onClick={() => setReturnForm(open => !open)} disabled={pending}>Solicitar devolução</button>}
    {returnForm && <form onSubmit={event => void requestReturn(event)}>
      <label>Kits para devolver <input name="quantity" type="number" defaultValue={1} min={1} max={99} required /></label>
      <label>Motivo <textarea name="reason" minLength={5} maxLength={500} required /></label>
      <button type="submit" disabled={pending}>Enviar solicitação</button>
    </form>}
    {returns.length > 0 && <ul aria-label="Devoluções">{returns.map(item => {
      const labels: Record<string, string> = { requested: "Solicitada", approved: "Aprovada", received: "Recebida",
        verified: "Em análise de estorno", refund_pending: "Estorno em andamento", completed: "Concluída", rejected: "Recusada" };
      return <li key={readString(item,"id")}>{labels[readString(item,"state")] ?? "Em análise"}
        {typeof item.quantity === "number" && <> · {item.quantity} kits</>}
        {typeof item.instructions === "string" && <p>{item.instructions}</p>}</li>;
    })}</ul>}
    {message && <p role="alert">{message}</p>}
  </div>;
}

export function RepresentativeKitOrderHistory({ checkoutConfigured }: { checkoutConfigured: boolean }) {
  const [orders, setOrders] = useState<UnknownRecord[] | null>(null);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  async function loadOrders() {
    setWaiting(true);
    setError("");
    try {
      const data = await kitRequest({ action: "list" });
      if (!Array.isArray(data.orders)) throw new Error("Não foi possível consultar seus pedidos.");
      setOrders(readRows(data.orders));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível consultar seus pedidos.");
    } finally {
      setWaiting(false);
    }
  }
  return <section aria-label="Meus pedidos de kits">
    <button type="button" className="secondary-button" onClick={() => void loadOrders()} disabled={waiting}>
      {waiting ? "Carregando pedidos…" : "Meus pedidos de kits"}
    </button>
    {error && <p role="alert">{error}</p>}
    {orders && (orders.length ? <ul className="representative-record-grid">
      {orders.map(order => <li key={readString(order, "orderId")} className="representative-card">
        <RepresentativeKitOrder initial={order} checkoutConfigured={checkoutConfigured} />
      </li>)}
    </ul> : <p role="status">Você ainda não tem pedidos de kits.</p>)}
  </section>;
}
