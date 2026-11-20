"use client";

import { formatBRL } from "@curtiz/domain";
import { useRef, useState, type FormEvent } from "react";
import { isUnknownRecord, readRows, readString, type UnknownRecord } from "../lib/unknown-data";
import { kitCashTenderInCents, RepresentativeKitCashChange } from "./representative-kit-cash-change";

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

export type RepresentativeKitSelection = { variantId: string } | { kitId: string; template: string };

const collectionMethods = {
  pix: "Pix", debit_card: "Cartão de débito", credit_card: "Cartão de crédito", cash: "Dinheiro"
};
type CollectionMethod = keyof typeof collectionMethods;

export function ReserveRepresentativeKit({ quantity, quoteId, addressId, totalInCents, collection = false, allowedCollectionMethods = [],
  ...selection }: RepresentativeKitSelection & {
  quantity: number; quoteId: string; addressId: string; totalInCents: number; collection?: boolean; allowedCollectionMethods?: string[];
}) {
  const requestKey = useRef("");
  const [order, setOrder] = useState<UnknownRecord | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [selectionLocked, setSelectionLocked] = useState(false);
  const [method, setMethod] = useState<CollectionMethod | "">("");
  const [tendered, setTendered] = useState("");
  const cashTendered = kitCashTenderInCents(tendered);
  const collectionReady = !collection || Boolean(method && allowedCollectionMethods.includes(method)
    && (method !== "cash" || cashTendered !== null && cashTendered >= totalInCents));
  async function reserve() {
    if (waiting || !collectionReady) return;
    setWaiting(true);
    setSelectionLocked(true);
    setError("");
    requestKey.current ||= crypto.randomUUID();
    try {
      const common = { quantity, quoteId, addressId, idempotencyKey: requestKey.current };
      const data = await kitRequest(collection ? {
        ...common, action: "reserve_collection", method,
        selectionId: "variantId" in selection ? selection.variantId : selection.kitId,
        ...("template" in selection ? { template: selection.template } : {}),
        ...(method === "cash" ? { cashTenderedInCents: cashTendered } : {})
      } : { ...common, action: "variantId" in selection ? "reserve" : "reserve_grade", ...selection });
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
    {collection && <fieldset disabled={selectionLocked}>
      <legend>Forma de pagamento no recebimento</legend>
      <label>Escolher forma de pagamento
        <select value={method} onChange={event => setMethod(event.target.value as CollectionMethod | "")}>
          <option value="">Selecione</option>
          {Object.entries(collectionMethods).filter(([value]) => allowedCollectionMethods.includes(value))
            .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {method === "cash" && <RepresentativeKitCashChange totalInCents={totalInCents} tendered={tendered} onTenderedChange={setTendered} />}
    </fieldset>}
    <button type="button" className="primary-button" disabled={waiting || !collectionReady} onClick={() => void reserve()}>
      {waiting ? "Confirmando…" : collection ? "Confirmar pagamento no recebimento" : "Reservar kit"}
    </button>
    {error && <p role="alert">{error}</p>}
  </>;
}

function RepresentativeKitOrder({ initial, checkoutConfigured }: { initial: UnknownRecord; checkoutConfigured: boolean }) {
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
  return <div className="representative-profile-form">
    {typeof order.productName === "string" && <strong>{order.productName}</strong>}
    <p role="status">{order.cancellationRequested === true && ["reserved", "payment_pending", "paid", "manual_review"].includes(state)
      ? "Cancelamento em confirmação" : statusLabels[state] ?? "Pedido em análise"}</p>
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
        <legend>Quantidade por SKU</legend>
        {pairOptions.map(option => {
          const sku = readString(option,"sku");
          return <label key={sku}>{readString(option,"size")} · {sku}
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
            <li key={sku}>{sku} · {String(quantity)} {quantity === 1 ? "par" : "pares"}</li>)}</ul>
          : typeof item.quantity === "number" && <> · {item.quantity} kits</>}
        {item.pickedUp === true ? <p>Retirada confirmada</p> : typeof item.pickupOn === "string" &&
          <p>Retirada agendada para {item.pickupOn.split("-").reverse().join("/")}</p>}
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
