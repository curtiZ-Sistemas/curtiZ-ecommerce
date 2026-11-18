"use client";

import { formatBRL } from "@curtiz/domain";
import { useRef, useState } from "react";
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
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const orderId = readString(order, "orderId");
  const state = readString(order, "state");
  const canCancel = ["reserved", "payment_pending"].includes(state) && order.cancellationRequested !== true;
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
      if (action === "status") setTracking(isUnknownRecord(data.tracking) ? data.tracking : null);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Não foi possível consultar o pedido.");
    } finally {
      setPending(false);
    }
  }
  const trackingCode = tracking ? readString(tracking, "trackingCode") : "";
  const shipmentStatus = tracking ? shipmentLabels[readString(tracking, "status")] : "";
  return <div className="representative-profile-form">
    {typeof order.productName === "string" && <strong>{order.productName}</strong>}
    <p role="status">{order.cancellationRequested === true && canCancel === false && ["reserved", "payment_pending"].includes(state)
      ? "Cancelamento em confirmação" : statusLabels[state] ?? "Pedido em análise"}</p>
    {typeof order.amountInCents === "number" && <p>Total {formatBRL(order.amountInCents)}</p>}
    {pix && <>
      <label>Pix copia e cola<input readOnly value={pix} onFocus={event => event.currentTarget.select()} /></label>
      <button type="button" className="secondary-button" onClick={() => {
        void navigator.clipboard.writeText(pix).then(() => setCopied(true)).catch(() => setMessage("Selecione e copie o código Pix."));
      }}>{copied ? "Código copiado" : "Copiar código Pix"}</button>
    </>}
    {state === "reserved" && checkoutConfigured && canCancel && <button type="button" className="primary-button"
      disabled={pending} onClick={() => void update("pix")}>Gerar Pix</button>}
    <button type="button" className="secondary-button" disabled={pending}
      onClick={() => void update("status")}>{pending ? "Consultando…" : "Atualizar situação"}</button>
    {canCancel && <button type="button" className="secondary-button" disabled={pending}
      onClick={() => void update("cancel")}>Cancelar pedido</button>}
    {shipmentStatus && <p role="status">{shipmentStatus}{trackingCode && <> · Rastreio {trackingCode}</>}</p>}
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
