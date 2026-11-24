"use client";

import { formatBRL } from "@curtiz/domain";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { isUnknownRecord, readRows, readString, type UnknownRecord } from "../lib/unknown-data";
import { RepresentativeKitCardPayment, type KitCardKind } from "./representative-kit-card-payment";
import { kitRequest, KitRequestError } from "./representative-kit-request";

export { kitRequest };

type StatusTone = "pending" | "success" | "review" | "muted";
const statusLabels: Record<string, string> = {
  reserved: "Aguardando pagamento", payment_pending: "Aguardando pagamento",
  paid: "Pagamento confirmado", cancelled: "Cancelado", refunded: "Estornado",
  manual_review: "Em análise", awaiting_receipt: "Pagamento no recebimento"
};
const statusTones: Record<string, StatusTone> = {
  reserved: "pending", payment_pending: "pending", paid: "success", awaiting_receipt: "success",
  manual_review: "review", cancelled: "muted", refunded: "muted"
};
const shipmentLabels: Record<string, string> = {
  pending: "Envio em preparação", ready: "Envio em preparação", label_created: "Etiqueta gerada",
  dispatched: "Enviado", in_transit: "Em transporte", delayed: "Entrega com atraso",
  delivered: "Entregue", returned: "Devolvido ao remetente", cancelled: "Envio cancelado"
};
const historyStates = ["cancelled", "refunded"];
// States where asking the server again can bring news (payment, review, tracking, returns).
const syncStates = ["payment_pending", "manual_review", "paid", "awaiting_receipt"];

function orderStatus(order: UnknownRecord, tracking: UnknownRecord | null): { label: string; tone: StatusTone } {
  const state = readString(order, "state");
  if (order.cancellationRequested === true && ["reserved", "payment_pending", "paid", "manual_review"].includes(state)) {
    return { label: "Cancelamento em confirmação", tone: "review" };
  }
  if (tracking?.status === "delivered") return { label: "Entregue", tone: "success" };
  return { label: statusLabels[state] ?? "Pedido em análise", tone: statusTones[state] ?? "review" };
}

function formatMoment(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(", ", " às ");
}

export type RepresentativeKitSelection = { variantId: string } | { kitId: string; template: string };

export const collectionMethods = {
  pix: "Pix", debit_card: "Cartão de débito", credit_card: "Cartão de crédito", cash: "Dinheiro"
};
export type CollectionMethod = keyof typeof collectionMethods;

export type PrepayMethod = "pix" | "credit_card" | "debit_card";
export const prepayMethods: Record<PrepayMethod, string> = { pix: "Pix", credit_card: "Cartão de crédito", debit_card: "Cartão de débito" };
const methodTabs: Record<PrepayMethod, string> = { pix: "Pix", credit_card: "Crédito", debit_card: "Débito" };
export const isPrepayMethod = (value: string): value is PrepayMethod => Object.hasOwn(prepayMethods, value);
const cardKinds: Record<Exclude<PrepayMethod, "pix">, KitCardKind> = { credit_card: "credit", debit_card: "debit" };

function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  return <span className={`kit-order-badge is-${tone}`}>{label}</span>;
}

export function RepresentativeKitOrder({ initial, checkoutConfigured, autoMethod = null, onOffersChanged, onChange }: {
  initial: UnknownRecord; checkoutConfigured: boolean; autoMethod?: PrepayMethod | null; onOffersChanged?: () => void;
  onChange?: (order: UnknownRecord) => void;
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
  const [payMethod, setPayMethod] = useState<PrepayMethod>(autoMethod ?? "pix");
  const [cardSubmitted, setCardSubmitted] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [issueCode, setIssueCode] = useState("");
  const orderId = readString(order, "orderId");
  const state = readString(order, "state");
  const canCancel = (["reserved", "payment_pending"].includes(state) || order.canCancelPaid === true || order.canCancelCollection === true)
    && order.cancellationRequested !== true;
  const method = readString(order, "collectionMethod") as CollectionMethod;
  const pixData = isUnknownRecord(order.pix) ? order.pix : null;
  const pix = pixData ? readString(pixData, "copyPaste") : "";
  const pixQr = pixData ? readString(pixData, "qrCodeBase64") : "";
  const choosing = state === "reserved" && checkoutConfigured && canCancel && !cardSubmitted;
  const cardKind = choosing && payMethod !== "pix" ? cardKinds[payMethod] : null;
  const orderState = useRef(state);
  orderState.current = state;
  async function update(action: "pix" | "status" | "cancel") {
    if (pending) return;
    setPending(true);
    setMessage("");
    setIssueCode("");
    setCopied(false);
    setConfirmCancel(false);
    try {
      const data = await kitRequest({ action, orderId });
      if (!isUnknownRecord(data.order)) throw new Error("Pedido indisponível para consulta.");
      const next = data.order;
      setOrder(current => ({ ...current, ...next, pix: next.pix }));
      onChange?.(next);
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
      onChange?.(next);
    }
    const status = isUnknownRecord(data.card) ? readString(data.card, "status") : "";
    setCardSubmitted(true);
    setMessage(status === "approved" ? "Pagamento aprovado."
      : status === "in_process" ? "Pagamento em análise. Avisaremos assim que o Mercado Pago confirmar."
        : "Pagamento enviado. Use Atualizar situação para acompanhar.");
    onOffersChanged?.();
  }
  function choose(next: PrepayMethod) {
    if (pending || next === payMethod) return;
    setPayMethod(next);
    setMessage("");
    setIssueCode("");
    if (next === "pix" && !pix) void update("pix");
  }
  const autoStarted = useRef(false);
  const startPix = useRef(update);
  startPix.current = update;
  useEffect(() => {
    // Only Pix needs a request to begin; the card form mounts as soon as it is the chosen method.
    if (autoMethod !== "pix" || autoStarted.current || !checkoutConfigured || state !== "reserved" || !canCancel) return;
    autoStarted.current = true;
    void startPix.current("pix");
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
  const status = orderStatus(order, tracking);
  const awaitingFiscal = state === "paid" && tracking?.fiscalStatus === "awaiting_fiscal_issuance";
  const reservedUntil = ["reserved", "payment_pending"].includes(state) ? formatMoment(order.reservedUntil) : "";
  const pixUntil = pixData ? formatMoment(pixData.expiresAt) : "";
  const showPayment = choosing || Boolean(pix);
  const canSync = syncStates.includes(state) || cardSubmitted;
  return <div className="kit-order-detail">
    <header className="kit-order-head">
      <div>
        {typeof order.productName === "string" && <h3 className="kit-order-title">{order.productName}</h3>}
        {typeof order.quantity === "number" && <p className="kit-order-meta">{order.quantity} {order.quantity === 1 ? "kit" : "kits"}</p>}
      </div>
      <StatusBadge {...status} />
    </header>
    {awaitingFiscal && <p role="status" className="kit-order-note">Aguardando emissão fiscal.</p>}
    {showPayment && <section className="kit-order-pay" aria-label="Pagamento">
      <div className="kit-order-summary">
        {typeof order.amountInCents === "number" && <p className="kit-order-total">
          <span>Total</span><strong>{formatBRL(order.amountInCents)}</strong></p>}
        {reservedUntil && <p className="kit-order-hold">Estoque reservado até {reservedUntil}</p>}
      </div>
      <div className="kit-order-pay-main">
        {choosing && <div className="kit-order-methods" role="radiogroup" aria-label="Forma de pagamento">
          {(Object.keys(methodTabs) as PrepayMethod[]).map(key => <button key={key} type="button" role="radio"
            aria-checked={payMethod === key} disabled={pending} className={payMethod === key ? "kit-order-method is-active" : "kit-order-method"}
            onClick={() => choose(key)}>{methodTabs[key]}</button>)}
        </div>}
        {cardKind
          ? <RepresentativeKitCardPayment key={cardKind} orderId={orderId} kind={cardKind} onResult={cardResult} />
          : pix ? <div className="kit-order-pix">
            {pixQr && <Image unoptimized src={`data:image/png;base64,${pixQr}`} width={220} height={220} alt="QR Code Pix" />}
            {pixQr && <p className="kit-order-hold">Escaneie o QR Code ou copie o código</p>}
            <label>Pix copia e cola<input readOnly value={pix} onFocus={event => event.currentTarget.select()} /></label>
            <button type="button" className="primary-button" onClick={() => {
              if (!navigator.clipboard) {
                setMessage("Selecione e copie o código Pix.");
                return;
              }
              void navigator.clipboard.writeText(pix).then(() => setCopied(true))
                .catch(() => setMessage("Selecione e copie o código Pix."));
            }}>{copied ? "Código copiado" : "Copiar código Pix"}</button>
            {pixUntil && <p className="kit-order-hold">Pague até {pixUntil}</p>}
          </div> : <div className="kit-order-pix">
            <p className="kit-order-hold">{pending ? "Gerando o Pix…" : "O código Pix vale por tempo limitado e é gerado ao confirmar."}</p>
            <button type="button" className="primary-button" disabled={pending} onClick={() => void update("pix")}>Gerar Pix</button>
          </div>}
      </div>
    </section>}
    {!showPayment && typeof order.amountInCents === "number" && <p className="kit-order-total">
      <span>Total</span><strong>{formatBRL(order.amountInCents)}</strong></p>}
    {method && Object.hasOwn(collectionMethods, method) && <p className="kit-order-meta">No recebimento · {collectionMethods[method]}</p>}
    {method === "cash" && typeof order.cashTenderedInCents === "number" && typeof order.cashChangeInCents === "number"
      && <p className="kit-order-meta">Valor informado {formatBRL(order.cashTenderedInCents)} · {order.cashChangeInCents > 0
        ? `Troco ${formatBRL(order.cashChangeInCents)}` : "Sem troco"}</p>}
    {state === "payment_pending" && order.paymentMethod === "card" && !pix && order.cancellationRequested !== true
      && <p role="status" className="kit-order-note">Pagamento no cartão em análise. Atualizaremos o pedido assim que o Mercado Pago confirmar.</p>}
    {shipmentStatus && <p role="status" className="kit-order-note">{shipmentStatus}{trackingCode && <> · Rastreio {trackingCode}</>}</p>}
    {(tracking?.status === "delivered" || tracking?.status === "returned") && ["paid","manual_review"].includes(state) &&
      <button type="button" className="secondary-button" aria-expanded={returnForm}
        onClick={() => setReturnForm(open => !open)} disabled={pending}>Solicitar devolução</button>}
    {returnForm && <form className="kit-order-return" onSubmit={event => void requestReturn(event)}>
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
      <button type="submit" className="primary-button" disabled={pending}>Enviar solicitação</button>
    </form>}
    {returns.length > 0 && <ul aria-label="Devoluções" className="kit-order-returns">{returns.map(item => {
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
    {confirmCancel && canCancel && <div className="kit-order-confirm" role="alertdialog" aria-label="Cancelar pedido">
      <p>Cancelar este pedido? O estoque reservado volta para o catálogo.</p>
      <div>
        <button type="button" className="kit-order-danger" disabled={pending}
          onClick={() => void update("cancel")}>Confirmar cancelamento</button>
        <button type="button" className="kit-order-link" disabled={pending} onClick={() => setConfirmCancel(false)}>Manter pedido</button>
      </div>
    </div>}
    {(canSync || (canCancel && !confirmCancel)) && <div className="kit-order-actions">
      {canSync && <button type="button" className="kit-order-link" disabled={pending}
        onClick={() => void update("status")}>{pending ? "Consultando…" : "Atualizar situação"}</button>}
      {canCancel && !confirmCancel && <button type="button" className="kit-order-link is-danger" disabled={pending}
        onClick={() => setConfirmCancel(true)}>Cancelar pedido</button>}
    </div>}
  </div>;
}

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function OrderRow({ order, onOpen }: { order: UnknownRecord; onOpen: () => void }) {
  const status = orderStatus(order, null);
  const until = ["reserved", "payment_pending"].includes(readString(order, "state")) ? formatMoment(order.reservedUntil) : "";
  return <li>
    <button type="button" className="kit-orders-row" onClick={onOpen}>
      <span className="kit-orders-row-name">
        <strong>{typeof order.productName === "string" && order.productName ? order.productName : "Kit"}</strong>
        <small>{typeof order.quantity === "number" ? `${order.quantity} ${order.quantity === 1 ? "kit" : "kits"}` : ""}
          {until ? ` · reserva até ${until}` : ""}</small>
      </span>
      <span className="kit-orders-row-total">{typeof order.amountInCents === "number" ? formatBRL(order.amountInCents) : ""}</span>
      <StatusBadge {...status} />
    </button>
  </li>;
}

export function RepresentativeKitOrderHistory({ checkoutConfigured, onOffersChanged }: {
  checkoutConfigured: boolean; onOffersChanged?: () => void;
}) {
  const [orders, setOrders] = useState<UnknownRecord[] | null>(null);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [auto, setAuto] = useState<{ id: string; method: PrepayMethod } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
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
  // The checkout sends the buyer here with the new order: the panel opens on it, ready to pay.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("pedido") ?? "";
    if (!orderIdPattern.test(id)) return;
    const method = params.get("pagamento") ?? "";
    setSelected(id);
    setAuto({ id, method: isPrepayMethod(method) ? method : "pix" });
    setOpen(true);
    void loadOrders();
  }, [loadOrders]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  const updateOrder = useCallback((orderId: string, next: UnknownRecord) => {
    setOrders(current => current && current.map(item => readString(item, "orderId") === orderId ? { ...item, ...next } : item));
  }, []);
  const active = orders?.filter(item => !historyStates.includes(readString(item, "state"))) ?? [];
  const history = orders?.filter(item => historyStates.includes(readString(item, "state"))) ?? [];
  const current = selected ? orders?.find(item => readString(item, "orderId") === selected) : undefined;
  const closePanel = () => { setOpen(false); setSelected(""); setAuto(null); };
  return <section aria-label="Meus pedidos de kits">
    <button type="button" className="secondary-button" aria-haspopup="dialog" disabled={waiting}
      onClick={() => { setOpen(true); void loadOrders(); }}>
      {waiting && !open ? "Carregando pedidos…" : "Meus pedidos de kits"}
    </button>
    <dialog ref={dialog} className="kit-orders-panel" aria-labelledby="kit-orders-title" onClose={closePanel}
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      {open && <div className="kit-orders-body">
        <header className="kit-orders-head">
          {current && orders && orders.length > 1
            ? <button type="button" className="kit-order-link" onClick={() => { setSelected(""); setAuto(null); }}>Todos os pedidos</button>
            : <span />}
          <h2 id="kit-orders-title">{current ? "Pedido" : "Meus pedidos de kits"}</h2>
          <button type="button" className="kit-order-link" onClick={() => dialog.current?.close()}>Fechar</button>
        </header>
        {error && <p role="alert">{error}</p>}
        {!orders && waiting && <p role="status">Carregando pedidos…</p>}
        {current
          ? <RepresentativeKitOrder key={selected} initial={current} checkoutConfigured={checkoutConfigured}
            autoMethod={auto && auto.id === selected ? auto.method : null} onOffersChanged={onOffersChanged}
            onChange={next => updateOrder(selected, next)} />
          : orders && (orders.length ? <>
            {active.length > 0 && <ul className="kit-orders-list" aria-label="Pedidos">
              {active.map(order => <OrderRow key={readString(order, "orderId")} order={order}
                onOpen={() => setSelected(readString(order, "orderId"))} />)}
            </ul>}
            {history.length > 0 && <details className="kit-orders-history">
              <summary>Histórico ({history.length})</summary>
              <ul className="kit-orders-list" aria-label="Histórico de pedidos">
                {history.map(order => <OrderRow key={readString(order, "orderId")} order={order}
                  onOpen={() => setSelected(readString(order, "orderId"))} />)}
              </ul>
            </details>}
          </> : <p role="status">Você ainda não tem pedidos de kits.</p>)}
      </div>}
    </dialog>
  </section>;
}
