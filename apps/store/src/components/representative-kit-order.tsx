"use client";

import { formatBRL } from "@curtiz/domain";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { isUnknownRecord, readRows, readString, type UnknownRecord } from "../lib/unknown-data";

const statusLabels: Record<string, string> = {
  reserved: "Estoque reservado", payment_pending: "Aguardando pagamento",
  paid: "Pagamento confirmado", cancelled: "Cancelado", refunded: "Estornado",
  manual_review: "Em análise", awaiting_receipt: "Pagamento no recebimento"
};
const shipmentLabels: Record<string, string> = {
  pending: "Envio em preparação", ready: "Envio em preparação", label_created: "Etiqueta gerada",
  dispatched: "Enviado", in_transit: "Em transporte", delayed: "Entrega com atraso",
  delivered: "Entregue", returned: "Devolvido ao remetente", cancelled: "Envio cancelado"
};

export async function kitRequest(body: UnknownRecord) {
  const response = await fetch("/api/representatives/kits/orders", {
    method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const data: unknown = await response.json();
  if (!response.ok || !isUnknownRecord(data) || data.ok !== true) {
    throw new Error(isUnknownRecord(data) ? readString(data, "message", "Operação indisponível.") : "Operação indisponível.");
  }
  return data;
}

export type RepresentativeKitSelection = { variantId: string } | { kitId: string; template: string };

export const collectionMethods = {
  pix: "Pix", debit_card: "Cartão de débito", credit_card: "Cartão de crédito", cash: "Dinheiro"
};
export type CollectionMethod = keyof typeof collectionMethods;

function RepresentativeKitOrder({ initial, checkoutConfigured, autoPix = false }: {
  initial: UnknownRecord; checkoutConfigured: boolean; autoPix?: boolean;
}) {
  const [order, setOrder] = useState(initial);
  const [tracking, setTracking] = useState<UnknownRecord | null>(null);
  const [returns, setReturns] = useState<UnknownRecord[]>([]);
  const [returnForm, setReturnForm] = useState(false);
  const [returnMode, setReturnMode] = useState("kits");
  const returnKey = useRef("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const orderId = readString(order, "orderId");
  const state = readString(order, "state");
  const canCancel = (["reserved", "payment_pending"].includes(state) || order.canCancelPaid === true || order.canCancelCollection === true)
    && order.cancellationRequested !== true;
  const method = readString(order, "collectionMethod") as CollectionMethod;
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
  const pixRequested = useRef(false);
  const startPix = useRef(update);
  startPix.current = update;
  useEffect(() => {
    if (!autoPix || pixRequested.current || !checkoutConfigured || state !== "reserved" || !canCancel) return;
    pixRequested.current = true;
    void startPix.current("pix");
  }, [autoPix, checkoutConfigured, state, canCancel]);
  async function requestReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (pending) return;
    const returningPairs = form.get("returnMode") === "pairs";
    const pairs = Object.fromEntries(pairOptions.map((option): [string, number] => [
      readString(option,"sku"), Number(form.get(`pair-${readString(option,"sku")}`))
    ]).filter(([,quantity]) => quantity > 0));
    if (returningPairs && !Object.keys(pairs).length) {
      setMessage("Informe pelo menos um par para devolver.");
      return;
    }
    setPending(true);
    setMessage("");
    returnKey.current ||= crypto.randomUUID();
    try {
      const data = await kitRequest({ action: "return", orderId, quantity: returningPairs ? 1 : Number(form.get("quantity")),
        ...(returningPairs ? { pairs } : {}),
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
  const pairOptions = readRows(order.returnablePairOptions);
  const sizeBySku = new Map(pairOptions.map(option => [readString(option,"sku"), readString(option,"size")]));
  return <div className="representative-profile-form">
    {typeof order.productName === "string" && <strong>{order.productName}</strong>}
    <p role="status">{order.cancellationRequested === true && ["reserved", "payment_pending", "paid", "manual_review"].includes(state)
      ? "Cancelamento em confirmação"
      : state === "paid" && tracking?.fiscalStatus === "awaiting_fiscal_issuance"
        ? "Pagamento confirmado. Aguardando emissão fiscal."
        : statusLabels[state] ?? "Pedido em análise"}</p>
    {typeof order.amountInCents === "number" && <p>Total {formatBRL(order.amountInCents)}</p>}
    {method && Object.hasOwn(collectionMethods, method) && <p>No recebimento · {collectionMethods[method]}</p>}
    {method === "cash" && typeof order.cashTenderedInCents === "number" && typeof order.cashChangeInCents === "number"
      && <p>Valor informado {formatBRL(order.cashTenderedInCents)} · {order.cashChangeInCents > 0
        ? `Troco ${formatBRL(order.cashChangeInCents)}` : "Sem troco"}</p>}
    {pix && <>
      <label>Pix copia e cola<input readOnly value={pix} onFocus={event => event.currentTarget.select()} /></label>
      <button type="button" className="secondary-button" onClick={() => {
        if (!navigator.clipboard) {
          setMessage("Selecione e copie o código Pix.");
          return;
        }
        void navigator.clipboard.writeText(pix).then(() => setCopied(true))
          .catch(() => setMessage("Selecione e copie o código Pix."));
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
      {pairOptions.length > 0 && <label>Itens para devolver
        <select name="returnMode" value={returnMode} onChange={event => setReturnMode(event.target.value)}>
          <option value="kits">Kits completos</option><option value="pairs">Pares avulsos</option>
        </select>
      </label>}
      {returnMode === "pairs" && pairOptions.length > 0 ? <fieldset>
        <legend>Pares por tamanho</legend>
        {pairOptions.map(option => {
          const sku = readString(option,"sku");
          return <label key={sku}>Tamanho {readString(option,"size")}
            <input name={`pair-${sku}`} type="number" defaultValue={0} min={0}
              max={typeof option.quantity === "number" ? option.quantity : 0} required />
          </label>;
        })}
      </fieldset> : <label>Kits para devolver <input name="quantity" type="number" defaultValue={1} min={1} max={99} required /></label>}
      <label>Motivo e orientações para a retirada <textarea name="reason" minLength={5} maxLength={500} required /></label>
      <button type="submit" disabled={pending}>Enviar solicitação</button>
    </form>}
    {returns.length > 0 && <ul aria-label="Devoluções">{returns.map(item => {
      const labels: Record<string, string> = { requested: "Solicitada", approved: "Aprovada", received: "Recebida",
        verified: "Em análise de estorno", refund_pending: "Estorno em andamento", completed: "Concluída", rejected: "Recusada" };
      return <li key={readString(item,"id")}>{labels[readString(item,"state")] ?? "Em análise"}
        {isUnknownRecord(item.requestedPairs)
          ? <ul>{Object.entries(item.requestedPairs).map(([sku,quantity]) =>
            <li key={sku}>{sizeBySku.get(sku) ? `Tamanho ${sizeBySku.get(sku)}` : "Pares"} · {String(quantity)} {quantity === 1 ? "par" : "pares"}</li>)}</ul>
          : typeof item.quantity === "number" && <> · {item.quantity} kits</>}
        {item.pickedUp === true ? <p>Retirada confirmada</p> : typeof item.pickupOn === "string" &&
          <p>Retirada agendada para {item.pickupOn.split("-").reverse().join("/")}</p>}
        {typeof item.instructions === "string" && <p>{item.instructions}</p>}</li>;
    })}</ul>}
    {message && <p role="alert">{message}</p>}
  </div>;
}

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function RepresentativeKitOrderHistory({ checkoutConfigured }: { checkoutConfigured: boolean }) {
  const [orders, setOrders] = useState<UnknownRecord[] | null>(null);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [highlight, setHighlight] = useState("");
  const loadOrders = useCallback(async () => {
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
  }, []);
  // The checkout sends the buyer here with the new order, ready to pay.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("pedido") ?? "";
    if (!orderIdPattern.test(id)) return;
    setHighlight(id);
    void loadOrders();
  }, [loadOrders]);
  const shown = orders && highlight
    ? [...orders].sort((a, b) => Number(readString(b, "orderId") === highlight) - Number(readString(a, "orderId") === highlight))
    : orders;
  return <section aria-label="Meus pedidos de kits">
    <button type="button" className="secondary-button" onClick={() => void loadOrders()} disabled={waiting}>
      {waiting ? "Carregando pedidos…" : "Meus pedidos de kits"}
    </button>
    {error && <p role="alert">{error}</p>}
    {shown && (shown.length ? <ul className="representative-record-grid">
      {shown.map(order => <li key={readString(order, "orderId")} className="representative-card">
        <RepresentativeKitOrder initial={order} checkoutConfigured={checkoutConfigured}
          autoPix={Boolean(highlight) && readString(order, "orderId") === highlight} />
      </li>)}
    </ul> : <p role="status">Você ainda não tem pedidos de kits.</p>)}
  </section>;
}
