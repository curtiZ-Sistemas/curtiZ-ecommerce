"use client";

import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { formatPostalCode, POSTAL_CODE_FORMATTED_MAX_LENGTH } from "../lib/personal-data";
import { isRepresentativeKitPostalCode, representativeKitState } from "../lib/representative-resale-scope";
import { isUnknownRecord } from "../lib/unknown-data";
import {
  deleteKitAddress, kitAddressPayload, kitAddressPostalCodeMessage, readKitAddresses, saveKitAddress, selectionAfterDelete,
  type KitAddress, type KitAddressBook
} from "./representative-kit-address-actions";
import { PostalCodeInput } from "./postal-code-input";

export type { KitAddress } from "./representative-kit-address-actions";

const maxAddresses = 3;

export function KitCheckoutAddress({ addressId, onSelect, onChanged }: {
  addressId: string; onSelect: (id: string) => void; onChanged?: () => void;
}) {
  const [book, setBook] = useState<KitAddressBook | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<KitAddress | null>(null);
  const [deleting, setDeleting] = useState<KitAddress | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(false);
  const picked = useRef(false);
  const current = useRef(addressId);
  current.current = addressId;
  useEffect(() => {
    const request = new AbortController();
    void fetch("/api/checkout/profile", { cache: "no-store", signal: request.signal }).then(async response => {
      const data: unknown = await response.json();
      if (!response.ok || !isUnknownRecord(data) || !Array.isArray(data.addresses)) throw new Error("invalid_addresses");
      if (request.signal.aborted) return;
      const next = readKitAddresses(data.addresses as unknown[]);
      setBook(next);
      if (current.current && !next.eligible.some(item => item.id === current.current)) onSelect("");
      else if (!picked.current && next.eligible.length === 1 && next.eligible[0]) onSelect(next.eligible[0].id);
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
  const forced = canAdd && total > 0 && !eligible.length;
  const showForm = editing !== null || (canAdd && (adding || forced));

  return <>
    {eligible.length > 0 && <fieldset className="kit-checkout-choices">
      <legend className="sr-only">Endereço de entrega</legend>
      {eligible.map(address => <KitAddressCard key={address.id} address={address} selected={address.id === addressId}
        onSelect={() => { picked.current = true; onSelect(address.id); }}
        onEdit={() => { setAdding(false); setEditing(address); }} onDelete={() => setDeleting(address)} />)}
    </fieldset>}
    {!eligible.length && !canAdd && <p className="kit-checkout-note">
      <Link href="/minha-conta/enderecos">Atualize um dos seus endereços</Link> para receber o kit.
    </p>}
    {!eligible.length && total === 0 && !showForm && <p className="kit-checkout-note">Nenhum endereço salvo.</p>}
    {showForm
      ? <KitAddressForm key={editing?.id ?? "new"} address={editing ?? undefined}
        onCancel={editing ? () => setEditing(null) : forced ? undefined : () => setAdding(false)}
        onSaved={(id) => {
          picked.current = true;
          setRetry(value => value + 1);
          if (editing) {
            setEditing(null);
            if (id === addressId) onChanged?.();
            return;
          }
          setAdding(false);
          onSelect(id);
        }} />
      : canAdd && <button type="button" className="secondary-button kit-checkout-add" onClick={() => setAdding(true)}>
        Novo endereço
      </button>}
    {deleting && <KitAddressDeleteDialog address={deleting} onCancel={() => setDeleting(null)}
      onConfirm={async () => {
        const result = await deleteKitAddress(deleting.id);
        if (!result.ok) return result.message;
        const remaining = eligible.filter(item => item.id !== deleting.id);
        setBook({ eligible: remaining, total: Math.max(total - 1, 0) });
        const next = selectionAfterDelete(addressId, deleting.id, remaining);
        if (next !== addressId) onSelect(next);
        if (editing?.id === deleting.id) setEditing(null);
        setDeleting(null);
        return "";
      }} />}
  </>;
}

export function KitAddressCard({ address, selected, onSelect, onEdit, onDelete }: {
  address: KitAddress; selected: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return <div className="kit-checkout-address-card" data-selected={selected || undefined}>
    <label className="kit-checkout-choice">
      <input type="radio" name="kit-address" value={address.id} checked={selected} onChange={onSelect} />
      <span><strong>{address.title}</strong><small>{address.line}</small><small>{address.place}</small></span>
    </label>
    <div className="kit-checkout-address-actions">
      <button type="button" className="kit-checkout-address-icon" aria-label="Editar endereço" title="Editar endereço" onClick={onEdit}>
        <Pencil size={18} aria-hidden="true" />
      </button>
      <button type="button" className="kit-checkout-address-icon is-danger" aria-label="Excluir endereço" title="Excluir endereço" onClick={onDelete}>
        <Trash2 size={18} aria-hidden="true" />
      </button>
    </div>
  </div>;
}

export function KitAddressDeleteDialog({ address, onCancel, onConfirm }: {
  address: KitAddress; onCancel: () => void; onConfirm: () => Promise<string>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const message = await onConfirm();
      if (message) { setError(message); setPending(false); }
    } catch {
      setError("Não foi possível excluir o endereço. Tente novamente.");
      setPending(false);
    }
  }

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) { event.stopPropagation(); onCancel(); return; }
    if (event.key !== "Tab") return;
    const items = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div className="kit-checkout-address-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !pending) onCancel(); }}>
    <div ref={dialog} className="kit-checkout-address-dialog" role="dialog" aria-modal="true"
      aria-labelledby="kit-address-delete-title" aria-describedby="kit-address-delete-text" onKeyDown={keys}>
      <h3 id="kit-address-delete-title">Excluir endereço?</h3>
      <p id="kit-address-delete-text">Tem certeza? {address.title}: {address.line}, {address.place}.</p>
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="kit-checkout-address-dialog-actions">
        <button ref={cancel} type="button" className="secondary-button" disabled={pending} onClick={onCancel}>Cancelar</button>
        <button type="button" className="kit-checkout-address-danger" disabled={pending} aria-busy={pending} onClick={() => void confirm()}>
          {pending ? "Excluindo…" : "Excluir"}
        </button>
      </div>
    </div>
  </div>;
}

function KitAddressForm({ address, onSaved, onCancel }: {
  address?: KitAddress; onSaved: (id: string) => void; onCancel?: () => void;
}) {
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
      setError(kitAddressPostalCodeMessage);
      return;
    }
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const result = await saveKitAddress(kitAddressPayload({
        recipientName: value("recipientName"), street: value("street"), number: value("number"), complement: value("complement"),
        district: value("district"), city: value("city"), postalCode
      }, address));
      if (!result.ok) { setError(result.message); return; }
      onSaved(result.id);
    } catch {
      setError("Não foi possível confirmar o endereço. Atualize a página e tente novamente.");
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return <form className="kit-checkout-form" onSubmit={event => void save(event)} aria-busy={pending}>
    <fieldset disabled={pending}>
      <legend>{address ? "Editar endereço" : "Novo endereço"}</legend>
      <div className="form-grid">
        <div className="field field-wide">
          <label htmlFor="kit-recipient">Destinatário</label>
          <input id="kit-recipient" name="recipientName" autoComplete="name" minLength={3} maxLength={120} required
            defaultValue={address?.recipientName} />
        </div>
        <div className="field">
          <label htmlFor="kit-postal">CEP</label>
          <PostalCodeInput id="kit-postal" name="postalCode" pattern="3\d{4}-?\d{3}" inputMode="numeric"
            maxLength={POSTAL_CODE_FORMATTED_MAX_LENGTH} placeholder="30000-000" autoComplete="postal-code" required
            defaultValue={address ? formatPostalCode(address.postalCode) : undefined} />
        </div>
        <div className="field">
          <label htmlFor="kit-state">Estado</label>
          <input id="kit-state" name="state" value={representativeKitState} readOnly aria-readonly="true" />
        </div>
        <div className="field field-wide">
          <label htmlFor="kit-street">Rua ou avenida</label>
          <input id="kit-street" name="street" autoComplete="address-line1" minLength={2} maxLength={160} required
            defaultValue={address?.street} />
        </div>
        <div className="field">
          <label htmlFor="kit-number">Número</label>
          <input id="kit-number" name="number" maxLength={20} required defaultValue={address?.number} />
        </div>
        <div className="field">
          <label htmlFor="kit-complement">Complemento</label>
          <input id="kit-complement" name="complement" autoComplete="address-line2" maxLength={100} defaultValue={address?.complement} />
        </div>
        <div className="field">
          <label htmlFor="kit-district">Bairro</label>
          <input id="kit-district" name="district" autoComplete="address-level3" minLength={2} maxLength={100} required
            defaultValue={address?.district} />
        </div>
        <div className="field">
          <label htmlFor="kit-city">Cidade</label>
          <input id="kit-city" name="city" autoComplete="address-level2" minLength={2} maxLength={100} required
            defaultValue={address?.city} />
        </div>
      </div>
      <div className="kit-checkout-form-actions">
        <button type="submit" className="primary-button">
          {pending ? "Salvando…" : address ? "Salvar alterações" : "Salvar endereço"}
        </button>
        {onCancel && <button type="button" className="secondary-button" onClick={onCancel}>Cancelar</button>}
      </div>
    </fieldset>
    {error && <p role="alert" className="field-error">{error}</p>}
  </form>;
}
