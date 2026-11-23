"use client";

import { formatBRL } from "@curtiz/domain";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { isUnknownRecord, readRows, readString, type UnknownRecord } from "../lib/unknown-data";
import { RepresentativeKitCardPayment, type KitCardKind } from "./representative-kit-card-payment";
import { kitRequest, KitRequestError } from "./representative-kit-request";

export { kitRequest };

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

export type RepresentativeKitSelection = { variantId: string } | { kitId: string; template: string };

export const collectionMethods = {
  pix: "Pix", debit_card: "Cartão de débito", credit_card: "Cartão de crédito", cash: "Dinheiro"
};
export type CollectionMethod = keyof typeof collectionMethods;

export type PrepayMethod = "pix" | "credit_card" | "debit_card";
export const prepayMethods: Record<PrepayMethod, string> = { pix: "Pix", credit_card: "Cartão de crédito", debit_card: "Cartão de débito" };
export const isPrepayMethod = (value: string): value is PrepayMethod => Object.hasOwn(prepayMethods, value);
const cardKinds: Record<Exclude<PrepayMethod, "pix">, KitCardKind> = { credit_card: "credit", debit_card: "debit" };

function RepresentativeKitOrder({ initial, checkoutConfigured, autoMethod = null, onOffersChanged }: {
  initial: UnknownRecord; checkoutConfigured: boolean; autoMethod?: PrepayMethod | null; onOffersChanged?: () => void;
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
  const [cardKind, setCardKind] = useState<KitCardKind | null>(null);
  const [issueCode, setIssueCode] = useState("");
  const orderId = readString(order, "orderId");
  const state = readString(order, "state");
  const canCancel = (["reserved", "payment_pending"].includes(state) || order.canCancelPaid === true || order.canCancelCollection === true)
    && order.cancellationRequested !== true;
  const method = readString(order, "collectionMethod") as CollectionMethod;
  const pix = isUnknownRecord(order.pix) ? readString(order.pix, "copyPaste") : "";
  const orderState = useRef(state);
  orderState.current = state;
  async function update(action: "pix" | "status" | "cancel") {
    if (pending) return;
    setPending(true);
    setMessage("");
    setIssueCode("");
    setCopied(false);
    try {
      const data = await kitRequest({ action, orderId });
      if (!isUnknownRecord(data.order)) throw new Error("Pedido indisponível para consulta.");
      const next = data.order;
      setOrder(current => ({ ...current, ...next, pix: next.pix }));
      // A cancelled or expired order gives its stock back: the offers must show it.
      if (action === "cancel" || readString(next, "state") !== orderState.current) onOffersChanged?.();
      if (action === "status") {
        setTracking(isUnknownRecord(data.tracking) ? data.tracking : null);
        setReturns(readRows(data.returns));
      }
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Não foi possível consultar o pedido.");
      setIssueCode(failure instanceof KitRequestError ? failure.code : "");
    } finally {
      setPending(false);
    }
  }
  function cardResult(data: UnknownRecord) {
    if (isUnknownRecord(data.order)) {
      const next = data.order;
      setOrder(current => ({ ...current, ...next, pix: undefined }));
    }
    const status = isUnknownRecord(data.card) ? readString(data.card, "status") : "";
    setCardKind(null);
    setMessage(status === "approved" ? "Pagamento aprovado."
      : status === "in_process" ? "Pagamento em análise. Avisaremos assim que o Mercado Pago confirmar."
        : "Pagamento enviado. Use Atualizar situação para acompanhar.");
    onOffersChanged?.();
  }
  const autoStarted = useRef(false);
  const startPix = useRef(update);
  startPix.current = update;
  useEffect(() => {
    if (!autoMethod || autoStarted.current || !checkoutConfigured || state !== "reserved" || !canCancel) return;
    autoStarted.current = true;
    if (autoMethod === "pix") void startPix.current("pix");
    else setCardKind(cardKinds[autoMethod]);
  }, [autoMethod, checkoutConfigured, state, canCancel]);
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
    {state === "payment_pending" && order.paymentMethod === "card" && !pix && order.cancellationRequested !== true
      && <p role="status">Pagamento no cartão em análise. Atualizaremos o pedido assim que o Mercado Pago confirmar.</p>}
    {state === "reserved" && checkoutConfigured && canCancel && <div className="kit-order-payment-actions">
      <button type="button" className="primary-button" disabled={pending} onClick={() => { setCardKind(null); void update("pix"); }}>Gerar Pix</button>
      <button type="button" className="secondary-button" disabled={pending} aria-expanded={cardKind === "credit"}
        onClick={() => setCardKind("credit")}>Pagar com cartão de crédito</button>
      <button type="button" className="secondary-button" disabled={pending} aria-expanded={cardKind === "debit"}
        onClick={() => setCardKind("debit")}>Pagar com cartão de débito</button>
    </div>}
    {state === "reserved" && checkoutConfigured && canCancel && cardKind
      && <RepresentativeKitCardPayment key={cardKind} orderId={orderId} kind={cardKind} onResult={cardResult} />}
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
    {issueCode === "PAYER_DOCUMENT_REQUIRED" && <p><Link href="/representante/solicitacao">Completar CPF ou CNPJ no cadastro</Link></p>}
  </div>;
}

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function RepresentativeKitOrderHistory({ checkoutConfigured, onOffersChanged }: {
  checkoutConfigured: boolean; onOffersChanged?: () => void;
}) {
  const [orders, setOrders] = useState<UnknownRecord[] | null>(null);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [highlight, setHighlight] = useState("");
  const [highlightMethod, setHighlightMethod] = useState<PrepayMethod>("pix");
  const offersChanged = useRef(onOffersChanged);
  offersChanged.current = onOffersChanged;
  const loadOrders = useCallback(async () => {
    setWaiting(true);
    setError("");
    try {
      const data = await kitRequest({ action: "list" });
      if (!Array.isArray(data.orders)) throw new Error("Não foi possível consultar seus pedidos.");
      setOrders(readRows(data.orders));
      // Holds that expired since the catalog was loaded already gave their stock back.
      offersChanged.current?.();
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
    const method = new URLSearchParams(window.location.search).get("pagamento") ?? "";
    if (isPrepayMethod(method)) setHighlightMethod(method);
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
          autoMethod={highlight && readString(order, "orderId") === highlight ? highlightMethod : null}
          onOffersChanged={onOffersChanged} />
      </li>)}
    </ul> : <p role="status">Você ainda não tem pedidos de kits.</p>)}
  </section>;
}
