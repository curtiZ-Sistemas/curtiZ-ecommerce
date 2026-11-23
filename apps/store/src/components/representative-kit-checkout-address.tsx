"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { POSTAL_CODE_FORMATTED_MAX_LENGTH } from "../lib/personal-data";
import { isRepresentativeKitPostalCode, representativeKitState } from "../lib/representative-resale-scope";
import { isUnknownRecord, readRows, readString } from "../lib/unknown-data";
import { PostalCodeInput } from "./postal-code-input";

export type KitAddress = { id: string; title: string; street: string; place: string };

const maxAddresses = 3;

function describe(row: { label: string; street: string; number: string; district: string; city: string; postalCode: string }): Omit<KitAddress, "id"> {
  return {
    title: row.label || "Endereço",
    street: [row.street, row.number].filter(Boolean).join(", "),
    place: [row.district, row.city, row.postalCode].filter(Boolean).join(" · ")
  };
}

function readAddresses(rows: unknown[]) {
  const eligible = readRows(rows).flatMap((row): KitAddress[] => {
    const postalCode = readString(row, "postalCode");
    const id = readString(row, "id");
    if (!id || row.state !== representativeKitState || !isRepresentativeKitPostalCode(postalCode)) return [];
    return [{ ...describe({
      label: readString(row, "label"), street: readString(row, "street"), number: readString(row, "number"),
      district: readString(row, "district"), city: readString(row, "city"), postalCode
    }), id }];
  });
  return { eligible, total: rows.length };
}

export function KitCheckoutAddress({ addressId, onSelect }: { addressId: string; onSelect: (id: string) => void }) {
  const [book, setBook] = useState<{ eligible: KitAddress[]; total: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(false);
  const picked = useRef(false);
  useEffect(() => {
    const request = new AbortController();
    void fetch("/api/checkout/profile", { cache: "no-store", signal: request.signal }).then(async response => {
      const data: unknown = await response.json();
      if (!response.ok || !isUnknownRecord(data) || !Array.isArray(data.addresses)) throw new Error("invalid_addresses");
      if (request.signal.aborted) return;
      const next = readAddresses(data.addresses as unknown[]);
      setBook(next);
      if (!picked.current && next.eligible.length === 1 && next.eligible[0]) onSelect(next.eligible[0].id);
    }).catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [retry, onSelect]);

  if (error) return <div role="alert" className="kit-checkout-note">
    <p>Não foi possível carregar seus endereços.</p>
    <button type="button" className="secondary-button" onClick={() => { setError(false); setRetry(value => value + 1); }}>
      Tentar novamente
    </button>
  </div>;
  if (!book) return <p role="status" className="kit-checkout-note">Carregando endereços…</p>;
  const { eligible, total } = book;
  const canAdd = total < maxAddresses;
  const showForm = canAdd && (adding || !eligible.length);
  return <>
    {eligible.length > 0 && <fieldset className="kit-checkout-choices">
      <legend className="sr-only">Endereço de entrega</legend>
      {eligible.map(address => <label key={address.id} className="kit-checkout-choice">
        <input type="radio" name="kit-address" value={address.id} checked={address.id === addressId}
          onChange={() => { picked.current = true; onSelect(address.id); }} />
        <span><strong>{address.title}</strong><small>{address.street}</small><small>{address.place}</small></span>
      </label>)}
    </fieldset>}
    {!eligible.length && !canAdd && <p className="kit-checkout-note">
      <Link href="/minha-conta/enderecos">Atualize um dos seus endereços</Link> para receber o kit.
    </p>}
    {showForm
      ? <KitAddressForm onCancel={eligible.length ? () => setAdding(false) : undefined} onSaved={(address) => {
        picked.current = true;
        setBook({ eligible: [...eligible, address], total: total + 1 });
        onSelect(address.id);
        setAdding(false);
      }} />
      : canAdd && <button type="button" className="secondary-button kit-checkout-add" onClick={() => setAdding(true)}>
        Novo endereço
      </button>}
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
    const value = (name: string) => {
      const field = form.get(name);
      return typeof field === "string" ? field.trim() : "";
    };
    const postalCode = value("postalCode");
    if (!isRepresentativeKitPostalCode(postalCode)) {
      setError("CEP fora da área de entrega");
      return;
    }
    const label = "Entrega de kits";
    const fields = {
      recipientName: value("recipientName"), street: value("street"), number: value("number"), complement: value("complement"),
      district: value("district"), city: value("city")
    };
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/customer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "address_save", label, ...fields, postalCode, state: representativeKitState, isDefault: false })
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !isUnknownRecord(data)) {
        setError((isUnknownRecord(data) && readString(data, "message")) || "Não foi possível salvar o endereço. Tente novamente.");
        return;
      }
      const id = readString(data, "data");
      if (!id) throw new Error("address_id_missing");
      onSaved({ ...describe({ label, ...fields, postalCode }), id });
    } catch {
      setError("Não foi possível confirmar o endereço. Atualize a página e tente novamente.");
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return <form className="kit-checkout-form" onSubmit={event => void save(event)} aria-busy={pending}>
    <fieldset disabled={pending}>
      <legend>Novo endereço</legend>
      <div className="form-grid">
        <div className="field field-wide">
          <label htmlFor="kit-recipient">Destinatário</label>
          <input id="kit-recipient" name="recipientName" autoComplete="name" minLength={3} maxLength={120} required />
        </div>
        <div className="field">
          <label htmlFor="kit-postal">CEP</label>
          <PostalCodeInput id="kit-postal" name="postalCode" pattern="3\d{4}-?\d{3}" inputMode="numeric"
            maxLength={POSTAL_CODE_FORMATTED_MAX_LENGTH} placeholder="30000-000" autoComplete="postal-code" required />
        </div>
        <div className="field">
          <label htmlFor="kit-state">Estado</label>
          <input id="kit-state" name="state" value={representativeKitState} readOnly aria-readonly="true" />
        </div>
        <div className="field field-wide">
          <label htmlFor="kit-street">Rua ou avenida</label>
          <input id="kit-street" name="street" autoComplete="address-line1" minLength={2} maxLength={160} required />
        </div>
        <div className="field">
          <label htmlFor="kit-number">Número</label>
          <input id="kit-number" name="number" maxLength={20} required />
        </div>
        <div className="field">
          <label htmlFor="kit-complement">Complemento</label>
          <input id="kit-complement" name="complement" autoComplete="address-line2" maxLength={100} />
        </div>
        <div className="field">
          <label htmlFor="kit-district">Bairro</label>
          <input id="kit-district" name="district" autoComplete="address-level3" minLength={2} maxLength={100} required />
        </div>
        <div className="field">
          <label htmlFor="kit-city">Cidade</label>
          <input id="kit-city" name="city" autoComplete="address-level2" minLength={2} maxLength={100} required />
        </div>
      </div>
      <div className="kit-checkout-form-actions">
        <button type="submit" className="primary-button">{pending ? "Salvando…" : "Salvar endereço"}</button>
        {onCancel && <button type="button" className="secondary-button" onClick={onCancel}>Cancelar</button>}
      </div>
    </fieldset>
    {error && <p role="alert" className="field-error">{error}</p>}
  </form>;
}
