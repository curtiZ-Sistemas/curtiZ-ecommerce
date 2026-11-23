"use client";

import { formatBRL } from "@curtiz/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isUnknownRecord, readString } from "../lib/unknown-data";
import { KitCheckoutAddress } from "./representative-kit-checkout-address";
import { kitRefusalMessages, useKitQuote, type KitQuoteState } from "./representative-kit-checkout-quote";
import { kitCashTenderInCents, RepresentativeKitCashChange } from "./representative-kit-cash-change";
import { readGradeCatalog, type GradeOffer } from "./representative-kit-grades";
import { collectionMethods, kitRequest, type CollectionMethod } from "./representative-kit-order";

type Mode = "prepay" | "collection";
const maxQuantity = 99;
const backHref = "/representante/comprar-kit";

function Page({ children }: { children: ReactNode }) {
  return <div className="checkout-page kit-checkout-page">
    <header className="checkout-heading kit-checkout-heading">
      <Link className="kit-checkout-back" href={backHref}>← Voltar aos kits</Link>
      <h1>Finalizar compra</h1>
    </header>
    {children}
  </div>;
}

function Message({ children, retry }: { children: ReactNode; retry?: () => void }) {
  return <div className="kit-checkout-empty" role="alert">
    <p>{children}</p>
    {retry ? <button type="button" className="secondary-button" onClick={retry}>Tentar novamente</button>
      : <Link className="secondary-button" href={backHref}>Voltar aos kits</Link>}
  </div>;
}

export function RepresentativeKitCheckout({ kitId, template, quantity }: { kitId: string; template: string; quantity: number }) {
  const [load, setLoad] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; offer: GradeOffer | null }>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    void fetch("/api/representatives/kits/grades", { cache: "no-store", signal: request.signal }).then(async response => {
      if (!response.ok) throw new Error("grades_unavailable");
      const catalog = readGradeCatalog(await response.json() as unknown);
      const offer = catalog.offers.find(item => item.kitId === kitId && item.templates.some(row => row.code === template)) ?? null;
      if (!request.signal.aborted) setLoad({ status: "ready", offer });
    }).catch(() => { if (!request.signal.aborted) setLoad({ status: "error" }); });
    return () => request.abort();
  }, [kitId, template, retry]);

  if (load.status === "loading") return <Page><p role="status" className="kit-checkout-note">Carregando…</p></Page>;
  if (load.status === "error") {
    return <Page><Message retry={() => { setLoad({ status: "loading" }); setRetry(value => value + 1); }}>
      Não foi possível carregar o kit.</Message></Page>;
  }
  const row = load.offer?.templates.find(item => item.code === template);
  if (!load.offer || !row || row.available <= 0) return <Page><Message>Esta ficha não está mais disponível.</Message></Page>;
  if (load.offer.buyerEnabled === false) return <Page><Message>{kitRefusalMessages.not_enabled}</Message></Page>;
  return <Page><CheckoutForm offer={load.offer} template={template} available={Math.min(row.available, maxQuantity)}
    initialQuantity={quantity} /></Page>;
}

function deliveryTime(days: number) {
  if (days < 0) return "";
  return days === 0 ? "No mesmo dia" : `Até ${days} ${days === 1 ? "dia" : "dias"}`;
}

function CheckoutForm({ offer, template, available, initialQuantity }: {
  offer: GradeOffer; template: string; available: number; initialQuantity: number;
}) {
  const router = useRouter();
  const row = offer.templates.find(item => item.code === template)!;
  const [quantity, setQuantity] = useState(Math.min(Math.max(initialQuantity, 1), available));
  const [addressId, setAddressId] = useState("");
  const [mode, setMode] = useState<Mode>("prepay");
  const [chosenMethod, setChosenMethod] = useState<CollectionMethod | "">("");
  const [tendered, setTendered] = useState("");
  const [retry, setRetry] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const request = useRef({ signature: "", key: "" });

  const base = { kitId: offer.kitId, template, quantity, addressId };
  const prepay = useKitQuote(addressId ? { ...base, mode: "prepay" } : null, retry);
  const collection = useKitQuote(addressId ? { ...base, mode: "collection" } : null, retry);
  const collectionOffered = collection.status === "ready";
  const active: Mode = mode === "collection" && collectionOffered ? "collection" : "prepay";
  const state: KitQuoteState = addressId ? (active === "collection" ? collection : prepay) : { status: "idle" };
  const quote = state.status === "ready" ? state.quote : null;

  const allowed = (Object.keys(collectionMethods) as CollectionMethod[]).filter(item => quote?.methods.includes(item));
  const method = active === "collection" ? (chosenMethod && allowed.includes(chosenMethod) ? chosenMethod
    : allowed.length === 1 ? allowed[0]! : "") : "";
  const cashTendered = kitCashTenderInCents(tendered);
  const paymentReady = active === "prepay" || Boolean(method
    && (method !== "cash" || cashTendered !== null && quote !== null && cashTendered >= quote.amount));
  const canFinish = Boolean(quote) && paymentReady && !waiting;
  const subtotal = row.unitPriceInCents * quantity;

  const selectAddress = useCallback((id: string) => setAddressId(id), []);

  async function finish() {
    if (!quote || !canFinish) return;
    setWaiting(true);
    setError("");
    const body = active === "collection"
      ? { action: "reserve_collection", selectionId: offer.kitId, template, quantity, quoteId: quote.id, addressId, method,
        ...(method === "cash" ? { cashTenderedInCents: cashTendered } : {}) }
      : { action: "reserve_grade", kitId: offer.kitId, template, quantity, quoteId: quote.id, addressId };
    const signature = JSON.stringify(body);
    if (request.current.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    try {
      const data = await kitRequest({ ...body, idempotencyKey: request.current.key });
      const orderId = isUnknownRecord(data.order) ? readString(data.order, "orderId") : "";
      if (!orderId) throw new Error("Pedido indisponível para consulta.");
      router.push(`${backHref}?pedido=${encodeURIComponent(orderId)}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível finalizar o pedido.");
      setWaiting(false);
    }
  }

  const change = (next: number) => setQuantity(Math.min(Math.max(next, 1), available));
  const refusal = prepay.status === "refused" ? prepay : null;
  return <div className="checkout-layout kit-checkout">
    <div className="checkout-form-column">
      <section className="checkout-section" aria-labelledby="kit-checkout-address">
        <h2 id="kit-checkout-address">Endereço de entrega</h2>
        <KitCheckoutAddress addressId={addressId} onSelect={selectAddress} />
      </section>
      <section className="checkout-section" aria-labelledby="kit-checkout-payment">
        <h2 id="kit-checkout-payment">Pagamento</h2>
        {!addressId ? <p className="kit-checkout-note">Escolha o endereço para ver as opções.</p> : <>
          {(prepay.status === "loading" || collection.status === "loading") && <p role="status" className="kit-checkout-note">Consultando entrega…</p>}
          {(prepay.status === "error" || collection.status === "error") && <div role="alert" className="kit-checkout-note">
            <p>Não foi possível consultar a entrega.</p>
            <button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>
          </div>}
          {refusal && <p role="alert" className="kit-checkout-note">
            {kitRefusalMessages[refusal.reason] ?? kitRefusalMessages.address}</p>}
          {prepay.status === "ready" && <fieldset className="kit-checkout-choices">
            <legend className="sr-only">Quando pagar</legend>
            <label className="kit-checkout-choice">
              <input type="radio" name="kit-payment" checked={active === "prepay"} onChange={() => setMode("prepay")} />
              <span><strong>Pagar agora (Pix)</strong><small>O Pix é gerado depois de finalizar o pedido.</small></span>
            </label>
            {collectionOffered && <label className="kit-checkout-choice">
              <input type="radio" name="kit-payment" checked={active === "collection"} onChange={() => setMode("collection")} />
              <span><strong>Pagar na entrega</strong><small>Você paga quando receber o kit.</small></span>
            </label>}
          </fieldset>}
          {active === "collection" && quote && <div className="kit-checkout-method">
            <fieldset className="kit-checkout-segmented">
              <legend>Forma de pagamento</legend>
              {allowed.map(item => <label key={item}>
                <input type="radio" name="kit-method" value={item} checked={method === item}
                  onChange={() => setChosenMethod(item)} />
                <span>{collectionMethods[item]}</span>
              </label>)}
            </fieldset>
            {method === "cash" && <RepresentativeKitCashChange totalInCents={quote.amount} tendered={tendered}
              onTenderedChange={setTendered} />}
          </div>}
        </>}
      </section>
    </div>

    <div className="checkout-order-column">
      <section className="checkout-order-products" aria-labelledby="kit-checkout-product">
        <header className="checkout-order-heading">
          <h2 id="kit-checkout-product">{offer.name}</h2>
          {offer.color && <span>{offer.color}</span>}
        </header>
        <p className="kit-checkout-template"><strong>{row.label}</strong><span>{formatBRL(row.unitPriceInCents)} por ficha</span></p>
        <table className="kit-checkout-sizes">
          <thead><tr><th scope="col">Tamanho</th>{row.sizes.map(size => <th scope="col" key={size.size}>{size.size}</th>)}</tr></thead>
          <tbody><tr><th scope="row">Pares</th>{row.sizes.map(size => <td key={size.size}>{size.pairs}</td>)}</tr></tbody>
        </table>
        <div className="kit-checkout-quantity">
          <label htmlFor="kit-checkout-quantity">Fichas</label>
          <div className="kit-checkout-stepper">
            <button type="button" aria-label="Diminuir quantidade" disabled={quantity <= 1 || waiting} onClick={() => change(quantity - 1)}>−</button>
            <output id="kit-checkout-quantity" aria-live="polite">{quantity}</output>
            <button type="button" aria-label="Aumentar quantidade" disabled={quantity >= available || waiting} onClick={() => change(quantity + 1)}>+</button>
          </div>
        </div>
      </section>
      <aside className="checkout-summary" aria-labelledby="kit-checkout-summary">
        <h2 id="kit-checkout-summary">Resumo</h2>
        <div className="checkout-totals">
          <div className="summary-line"><span>Subtotal</span><strong>{formatBRL(subtotal)}</strong></div>
          <div className="summary-line"><span>Entrega</span>
            <strong>{quote ? (quote.shipping === 0 ? "Grátis" : formatBRL(quote.shipping)) : "A calcular"}</strong></div>
          {quote && deliveryTime(quote.days) && <div className="summary-line"><span>Prazo</span><strong>{deliveryTime(quote.days)}</strong></div>}
          <div className="summary-line summary-total"><span>Total</span><strong>{quote ? formatBRL(quote.amount) : "—"}</strong></div>
        </div>
        <button type="button" className="primary-button full-button checkout-button" disabled={!canFinish}
          aria-busy={waiting} onClick={() => void finish()}>
          {waiting ? "Finalizando…" : "Finalizar pedido"}
        </button>
        {error && <p role="alert" className="field-error">{error}</p>}
      </aside>
    </div>
  </div>;
}
