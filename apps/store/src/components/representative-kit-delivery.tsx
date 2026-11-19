"use client";

import { formatBRL } from "@curtiz/domain";
import { useEffect, useState } from "react";
import { isRepresentativeKitPostalCode, representativeKitState } from "../lib/representative-resale-scope";
import { isUnknownRecord, readNumber, readRows, readString } from "../lib/unknown-data";
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
  const [mode, setMode] = useState<"prepay" | "collection">("prepay");
  return <>
    <label>Quando pagar
      <select value={mode} onChange={event => setMode(event.target.value === "collection" ? "collection" : "prepay")}>
        <option value="prepay">Pagar agora</option>
        <option value="collection">Pagar no recebimento</option>
      </select>
    </label>
    <OwnDeliveryQuote key={mode} selection={selection} quantity={quantity} addressId={address.id} mode={mode} />
  </>;
}

function OwnDeliveryQuote({ selection, quantity, addressId, mode }: {
  selection: RepresentativeKitSelection; quantity: number; addressId: string; mode: "prepay" | "collection";
}) {
  const payload = JSON.stringify({ ...selection, quantity, addressId, paymentTiming: mode });
  const [quote, setQuote] = useState<{ id: string; amount: number; shipping: number; days: number } | null>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    void fetch("/api/representatives/kits/collection", {
      method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: request.signal
    }).then(async response => {
      const data: unknown = await response.json();
      if (request.signal.aborted) return;
      if (!response.ok || !isUnknownRecord(data)) throw new Error("invalid_delivery");
      if (data.quote === null) { setQuote(null); return; }
      if (!isUnknownRecord(data.quote)) throw new Error("invalid_delivery");
      const id = readString(data.quote, "id");
      const amount = readNumber(data.quote, "amountInCents");
      const shipping = readNumber(data.quote, "shippingInCents", -1);
      const days = readNumber(data.quote, "estimatedDays", -1);
      if (!id || !Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(shipping) || shipping < 0) {
        throw new Error("invalid_delivery");
      }
      setQuote({ id, amount, shipping, days });
    }).catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [payload, retry]);
  if (error) return <div role="alert">
    <p>Não foi possível consultar a entrega.</p>
    <button type="button" onClick={() => { setError(false); setRetry(value => value + 1); }}>Tentar novamente</button>
  </div>;
  if (quote === undefined) return <p role="status">Consultando entrega…</p>;
  if (quote === null) return <p role="status">Entrega indisponível para este endereço ou forma de pagamento.</p>;
  return <>
    <p>Entrega pela curti Z · {formatBRL(quote.shipping)}
      {quote.days >= 0 && (quote.days === 0 ? " · No mesmo dia" : ` · Até ${quote.days} ${quote.days === 1 ? "dia" : "dias"}`)}</p>
    <ReserveRepresentativeKit {...selection} quantity={quantity} addressId={addressId} quoteId={quote.id}
      totalInCents={quote.amount} collection={mode === "collection"} />
  </>;
}
