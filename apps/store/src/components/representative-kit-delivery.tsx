"use client";

import { formatBRL } from "@curtiz/domain";
import { useEffect, useState } from "react";
import { isRepresentativeKitPostalCode, representativeKitState } from "../lib/representative-resale-scope";
import { isUnknownRecord, readNumber, readRows, readString } from "../lib/unknown-data";
import { ProductShippingPreview } from "./product-shipping-preview";
import { ReserveRepresentativeKit, type RepresentativeKitSelection } from "./representative-kit-order";

export function RepresentativeKitDelivery({ quantity, ...selection }: RepresentativeKitSelection & { quantity: number }) {
  const [shown, setShown] = useState(false);
  return <>
    <button type="button" className="secondary-button" aria-expanded={shown} onClick={() => setShown(value => !value)}>
      {shown ? "Fechar endereços salvos" : "Usar endereço salvo"}
    </button>
    {shown && <SavedKitAddress selection={selection} quantity={quantity} />}
  </>;
}

type KitAddress = { id: string; postalCode: string; label: string };
function SavedKitAddress({ selection, quantity }: { selection: RepresentativeKitSelection; quantity: number }) {
  const [addresses, setAddresses] = useState<KitAddress[] | null>(null);
  const [addressId, setAddressId] = useState("");
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    const request = new AbortController();
    void fetch("/api/checkout/profile", { cache: "no-store", signal: request.signal }).then(async response => {
      const data: unknown = await response.json();
      if (!response.ok || !isUnknownRecord(data) || !Array.isArray(data.addresses)) throw new Error("invalid_addresses");
      const eligible = readRows(data.addresses).flatMap(row => {
        const postalCode = readString(row, "postalCode");
        const id = readString(row, "id");
        if (!id || row.state !== representativeKitState || !isRepresentativeKitPostalCode(postalCode)) return [];
        return [{ id, postalCode, label: [readString(row, "label"), readString(row, "city"), postalCode].filter(Boolean).join(" · ") }];
      });
      if (!request.signal.aborted) setAddresses(eligible);
    }).catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [retry]);
  if (error) return <div role="alert">
    <p>Não foi possível carregar seus endereços.</p>
    <button type="button" onClick={() => { setError(false); setRetry(value => value + 1); }}>Tentar novamente</button>
  </div>;
  if (!addresses) return <p role="status">Carregando endereços…</p>;
  if (!addresses.length) return <p role="status">Cadastre um endereço de entrega em Minas Gerais na sua conta.</p>;
  const selected = addresses.find(address => address.id === addressId);
  return <>
    <label>Endereço de entrega
      <select value={addressId} onChange={event => setAddressId(event.target.value)}>
        <option value="">Selecione</option>
        {addresses.map(address => <option key={address.id} value={address.id}>{address.label}</option>)}
      </select>
    </label>
    {selected && <SelectDeliveryPayment key={JSON.stringify([selection, quantity, selected.id])}
      selection={selection} quantity={quantity} address={selected} />}
  </>;
}

function SelectDeliveryPayment({ selection, quantity, address }: {
  selection: RepresentativeKitSelection; quantity: number; address: KitAddress;
}) {
  const payload = JSON.stringify({ ...selection, quantity, addressId: address.id });
  const [quote, setQuote] = useState<{ id: string; amount: number; shipping: number; service: string } | null>(null);
  const [mode, setMode] = useState<"prepay" | "collection">("prepay");
  useEffect(() => {
    const request = new AbortController();
    void fetch("/api/representatives/kits/collection", {
      method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: request.signal
    }).then(async response => {
      const data: unknown = await response.json();
      if (!response.ok || !isUnknownRecord(data) || !isUnknownRecord(data.quote) || request.signal.aborted) return;
      const id = readString(data.quote, "id");
      const amount = readNumber(data.quote, "amountInCents");
      const shipping = readNumber(data.quote, "shippingInCents", -1);
      if (id && Number.isSafeInteger(amount) && amount > 0 && Number.isSafeInteger(shipping) && shipping >= 0) {
        setQuote({ id, amount, shipping, service: readString(data.quote, "service", "Entrega local") });
      }
    }).catch(() => { /* The regular freight service remains available during a collection lookup failure. */ });
    return () => request.abort();
  }, [payload]);
  return <>
    {quote && <label>Quando pagar
      <select value={mode} onChange={event => setMode(event.target.value === "collection" ? "collection" : "prepay")}>
        <option value="prepay">Pagar agora</option>
        <option value="collection">Pagar no recebimento</option>
      </select>
    </label>}
    {mode === "collection" && quote ? (
      <>
        <p>{quote.service} · Frete {formatBRL(quote.shipping)}</p>
        <ReserveRepresentativeKit {...selection} quantity={quantity} addressId={address.id} quoteId={quote.id}
          totalInCents={quote.amount} collection />
      </>
    ) : "variantId" in selection ? (
      <SelectKitFreight variantId={selection.variantId} quantity={quantity} address={address} />
    ) : (
      <SelectGradeFreight kitId={selection.kitId} template={selection.template} quantity={quantity} addressId={address.id} />
    )}
  </>;
}

function SelectGradeFreight({ kitId, template, quantity, addressId }: {
  kitId: string; template: string; quantity: number; addressId: string;
}) {
  const [estimates, setEstimates] = useState<{ id: string; label: string }[] | null>(null);
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [confirmed, setConfirmed] = useState<{ id: string; amount: number; available: boolean } | null>(null);

  useEffect(() => {
    const request = new AbortController();
    void fetch("/api/representatives/kits/grades", {
      method: "POST", headers: { "content-type": "application/json" }, signal: request.signal,
      body: JSON.stringify({ kitId, template, quantity, addressId })
    }).then(async response => {
      const data: unknown = await response.json();
      if (!response.ok || !isUnknownRecord(data) || !Array.isArray(data.quotes)) {
        throw new Error(isUnknownRecord(data) ? readString(data, "message") : "");
      }
      const options = readRows(data.quotes).flatMap(row => {
        const id = readString(row, "serviceId");
        const value = readNumber(row, "shippingInCents", -1);
        return id && value >= 0 ? [{ id,
          label: `${readString(row, "carrier")} · ${readString(row, "service")} · ${formatBRL(value)}` }] : [];
      });
      if (!request.signal.aborted) setEstimates(options);
    }).catch((failure: unknown) => {
      if (!request.signal.aborted) setError(failure instanceof Error && failure.message
        ? failure.message : "Não foi possível calcular o frete da ficha.");
    });
    return () => request.abort();
  }, [addressId, kitId, quantity, retry, template]);

  async function confirm() {
    if (pending || !selected) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/representatives/kits/grades", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kitId, template, quantity, addressId, serviceId: selected })
      });
      const data: unknown = await response.json();
      if (!response.ok || !isUnknownRecord(data) || !isUnknownRecord(data.quote)) throw new Error();
      const id = readString(data.quote, "id");
      const amount = readNumber(data.quote, "amountInCents", -1);
      if (!id || !Number.isSafeInteger(amount) || amount <= 0) throw new Error();
      setConfirmed({ id, amount, available: data.quote.purchaseAvailable === true });
    } catch {
      setError("Não foi possível confirmar o frete. Selecione o serviço novamente.");
    } finally {
      setPending(false);
    }
  }

  if (!estimates) return error
    ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>Tentar novamente</button></div>
    : <p role="status">Calculando o frete da ficha…</p>;
  if (!estimates.length) return <p role="status">Nenhum frete disponível para o endereço.</p>;
  return <>
    <label>Serviço de entrega
      <select value={selected} disabled={pending} onChange={event => { setSelected(event.target.value); setConfirmed(null); setError(""); }}>
        <option value="">Selecione</option>
        {estimates.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
    <button type="button" className="secondary-button" disabled={!selected || pending || confirmed !== null} onClick={() => void confirm()}>
      {pending ? "Conferindo frete…" : "Confirmar frete"}
    </button>
    {error && <p role="alert">{error}</p>}
    {confirmed && (confirmed.available
      ? <ReserveRepresentativeKit kitId={kitId} template={template} quantity={quantity} quoteId={confirmed.id}
        addressId={addressId} totalInCents={confirmed.amount} />
      : <p role="status">A compra desta ficha aguarda homologação.</p>)}
  </>;
}

function SelectKitFreight({ variantId, quantity, address }: { variantId: string; quantity: number; address: KitAddress }) {
  const [serviceId, setServiceId] = useState("");
  const [result, setResult] = useState<{ id: string; amountInCents: number; totalInCents: number | null } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!serviceId) return;
    const request = new AbortController();
    void fetch("/api/representatives/kits/quote", { method: "POST",
      headers: { "content-type": "application/json" }, cache: "no-store", signal: request.signal,
      body: JSON.stringify({ mode: "checkout", variantId, quantity, addressId: address.id, serviceId })
    }).then(async response => {
      const data: unknown = await response.json();
      if (!response.ok || !isUnknownRecord(data) || !isUnknownRecord(data.quote)
        || !readString(data.quote, "id") || data.quote.serviceId !== serviceId
        || !Number.isSafeInteger(data.quote.amountInCents) || Number(data.quote.amountInCents) < 0) {
        throw new Error("invalid_quote");
      }
      if (!request.signal.aborted) setResult({ id: readString(data.quote, "id"), amountInCents: Number(data.quote.amountInCents),
        totalInCents: data.purchaseAvailable === true && Number.isSafeInteger(data.totalInCents) ? Number(data.totalInCents) : null });
    }).catch(() => {
      if (!request.signal.aborted) setError(true);
    }).finally(() => { if (!request.signal.aborted) setServiceId(""); });
    return () => request.abort();
  }, [address.id, quantity, serviceId, variantId]);
  return <>
    <ProductShippingPreview mode="kit" variantId={variantId} quantity={quantity} savedPostalCode={address.postalCode}
      onSelectService={id => { if (!serviceId) { setError(false); setResult(null); setServiceId(id); } }} />
    <p role="status">{serviceId ? "Conferindo frete…" : error
      ? "Não foi possível confirmar o frete. Selecione o serviço novamente."
      : result ? `Frete conferido para o endereço: ${formatBRL(result.amountInCents)}.` : ""}</p>
    {result && (result.totalInCents === null ? <p>A compra deste kit aguarda homologação.</p>
      : <ReserveRepresentativeKit key={result.id} variantId={variantId} quantity={quantity} quoteId={result.id}
        addressId={address.id} totalInCents={result.totalInCents} />)}
  </>;
}
