"use client";

import { formatBRL } from "@curtiz/domain";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { POSTAL_CODE_FORMATTED_MAX_LENGTH } from "../lib/personal-data";
import { isRepresentativeKitPostalCode, representativeKitState } from "../lib/representative-resale-scope";
import { isUnknownRecord, readNumber, readRows, readString } from "../lib/unknown-data";
import { PostalCodeInput } from "./postal-code-input";
import { ReserveRepresentativeKit, type RepresentativeKitSelection } from "./representative-kit-order";

export function RepresentativeKitDelivery({ quantity, ...selection }: RepresentativeKitSelection & { quantity: number }) {
  const [shown, setShown] = useState(false);
  return <>
    <button type="button" className="secondary-button" aria-expanded={shown} onClick={() => setShown(value => !value)}>
      {shown ? "Fechar endereço de entrega" : "Informar endereço de entrega"}
    </button>
    {shown && <SavedKitAddress selection={selection} quantity={quantity} />}
  </>;
}

type KitAddress = { id: string; postalCode: string; label: string };
function SavedKitAddress({ selection, quantity }: { selection: RepresentativeKitSelection; quantity: number }) {
  const [addressBook, setAddressBook] = useState<{ eligible: KitAddress[]; total: number } | null>(null);
  const [addressId, setAddressId] = useState("");
  const [adding, setAdding] = useState(false);
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
      if (!request.signal.aborted) setAddressBook({ eligible, total: data.addresses.length });
    }).catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [retry]);
  if (error) return <div role="alert">
    <p>Não foi possível carregar seus endereços.</p>
    <button type="button" onClick={() => { setError(false); setRetry(value => value + 1); }}>Tentar novamente</button>
  </div>;
  if (!addressBook) return <p role="status">Carregando endereços…</p>;
  const { eligible: addresses, total } = addressBook;
  const selected = addresses.find(address => address.id === addressId);
  if (total >= 3 && !addresses.length) return <p>
    <Link href="/minha-conta/enderecos">Atualize um dos seus endereços</Link> para entrega em Minas Gerais.
  </p>;
  return <>
    {addresses.length > 0 && <label>Endereço de entrega
      <select value={addressId} onChange={event => setAddressId(event.target.value)}>
        <option value="">Selecione</option>
        {addresses.map(address => <option key={address.id} value={address.id}>{address.label}</option>)}
      </select>
    </label>}
    {total < 3 && (adding || !addresses.length
      ? <KitAddressForm onCancel={addresses.length ? () => setAdding(false) : undefined} onSaved={address => {
        setAddressBook({ eligible: [...addresses, address], total: total + 1 });
        setAddressId(address.id);
        setAdding(false);
      }} />
      : <button type="button" className="secondary-button" onClick={() => setAdding(true)}>Cadastrar endereço</button>)}
    {selected && !adding && <SelectDeliveryPayment key={JSON.stringify([selection, quantity, selected.id])}
      selection={selection} quantity={quantity} address={selected} />}
  </>;
}

function KitAddressForm({ onSaved, onCancel }: { onSaved: (address: KitAddress) => void; onCancel?: () => void }) {
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const postalCode = value("postalCode");
    if (!isRepresentativeKitPostalCode(postalCode)) {
      setError("Informe um CEP de Minas Gerais.");
      return;
    }

    const city = value("city");
    const label = "Entrega de kits";
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/customer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "address_save", label, recipientName: value("recipientName"), postalCode,
          street: value("street"), number: value("number"), complement: value("complement"),
          district: value("district"), city, state: representativeKitState, isDefault: false
        })
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !isUnknownRecord(data)) {
        setError((isUnknownRecord(data) && readString(data,"message")) || "Não foi possível salvar o endereço. Tente novamente.");
        return;
      }
      const id = readString(data, "data");
      if (!id) throw new Error("address_id_missing");
      onSaved({ id, postalCode, label: [label, city, postalCode].join(" · ") });
    } catch {
      setError("Não foi possível confirmar o endereço. Atualize a lista antes de tentar novamente.");
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return <form className="representative-profile-form" onSubmit={event => void save(event)} aria-busy={pending}>
    <fieldset disabled={pending} className="representative-profile-form">
      <legend>Novo endereço de entrega em Minas Gerais</legend>
      <label>Destinatário <input name="recipientName" autoComplete="name" minLength={3} maxLength={120} required /></label>
      <label>CEP <PostalCodeInput name="postalCode" pattern="3\d{4}-?\d{3}" inputMode="numeric"
        maxLength={POSTAL_CODE_FORMATTED_MAX_LENGTH} placeholder="30000-000" autoComplete="postal-code" required /></label>
      <label>Rua ou avenida <input name="street" autoComplete="address-line1" minLength={2} maxLength={160} required /></label>
      <label>Número <input name="number" maxLength={20} required /></label>
      <label>Complemento <input name="complement" autoComplete="address-line2" maxLength={100} /></label>
      <label>Bairro <input name="district" autoComplete="address-level3" minLength={2} maxLength={100} required /></label>
      <label>Cidade <input name="city" autoComplete="address-level2" minLength={2} maxLength={100} required /></label>
      <button type="submit" className="primary-button">{pending ? "Salvando endereço…" : "Salvar e usar endereço"}</button>
      {onCancel && <button type="button" className="secondary-button" onClick={onCancel}>Cancelar</button>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </form>;
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
  const [quote, setQuote] = useState<{ id: string; amount: number; shipping: number; days: number; methods: string[] } | null>();
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
      const methods = Array.isArray(data.quote.collectionMethods)
        ? (data.quote.collectionMethods as unknown[]).filter((item): item is string => typeof item === "string") : [];
      if (!id || !Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(shipping) || shipping < 0) {
        throw new Error("invalid_delivery");
      }
      setQuote(mode === "collection" && methods.length === 0 ? null : { id, amount, shipping, days, methods });
    }).catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [mode, payload, retry]);
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
      totalInCents={quote.amount} collection={mode === "collection"} allowedCollectionMethods={quote.methods} />
  </>;
}
