"use client";

import { formatBRL } from "@curtiz/domain";
import { useEffect, useState } from "react";
import { isRepresentativeKitPostalCode, representativeKitState } from "../lib/representative-resale-scope";
import { isUnknownRecord, readRows, readString } from "../lib/unknown-data";
import { ProductShippingPreview } from "./product-shipping-preview";
import { ReserveRepresentativeKit } from "./representative-kit-order";

export function RepresentativeKitDelivery({ variantId, quantity }: { variantId: string; quantity: number }) {
  const [shown, setShown] = useState(false);
  return <>
    <button type="button" className="secondary-button" aria-expanded={shown} onClick={() => setShown(value => !value)}>
      {shown ? "Fechar endereços salvos" : "Usar endereço salvo"}
    </button>
    {shown && <SavedKitAddress variantId={variantId} quantity={quantity} />}
  </>;
}

type KitAddress = { id: string; postalCode: string; label: string };
function SavedKitAddress({ variantId, quantity }: { variantId: string; quantity: number }) {
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
    {selected && <SelectKitFreight key={`${variantId}:${quantity}:${selected.id}`}
      variantId={variantId} quantity={quantity} address={selected} />}
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
