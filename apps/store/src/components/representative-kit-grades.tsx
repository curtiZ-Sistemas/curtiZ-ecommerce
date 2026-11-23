"use client";

import { formatBRL } from "@curtiz/domain";
import Link from "next/link";
import { useId, useState } from "react";
import { isUnknownRecord, readRows, readString, readNumber } from "../lib/unknown-data";

type GradeSize = { size: string; pairs: number };
type GradeTemplate = {
  code: string;
  label: string;
  available: number;
  unitPriceInCents: number;
  sizes: GradeSize[];
};
export type GradeOffer = {
  kitId: string;
  name: string;
  description: string;
  templates: GradeTemplate[];
  buyerEnabled: boolean | null;
};
export type GradeCatalog = {
  offers: GradeOffer[]; orderHistoryAvailable: boolean; checkoutConfigured: boolean; buyerEnabled: boolean | null;
};

export function readGradeCatalog(value: unknown): GradeCatalog {
  if (!isUnknownRecord(value) || !Array.isArray(value.items)) throw new Error("Fichas indisponíveis.");
  const buyerEnabled = typeof value.buyerEnabled === "boolean" ? value.buyerEnabled : null;
  return {
    buyerEnabled,
    orderHistoryAvailable: value.orderHistoryAvailable === true,
    checkoutConfigured: value.checkoutConfigured === true,
    offers: readRows(value.items).map(item => ({
      kitId: readString(item, "kitId"),
      name: readString(item, "name"),
      description: readString(item, "description"),
      buyerEnabled,
      templates: readRows(item.templates).map(template => ({
        code: readString(template, "code"),
        label: readString(template, "label"),
        available: readNumber(template, "available"),
        unitPriceInCents: readNumber(template, "unitPriceInCents", readNumber(item, "unitPriceInCents")),
        sizes: readRows(template.sizes).map(size => ({ size: readString(size, "size"), pairs: readNumber(size, "pairs") }))
      }))
    }))
  };
}

const maxQuantity = 99;

function availabilityLabel(available: number) {
  return available > 0 ? `${available} ${available === 1 ? "disponível" : "disponíveis"}` : "Esgotada";
}

function GradeCard({ offer }: { offer: GradeOffer }) {
  const groupId = useId();
  const [selected, setSelected] = useState(offer.templates.find(template => template.available > 0)?.code ?? "");
  const [quantity, setQuantity] = useState("1");
  const template = offer.templates.find(item => item.code === selected);
  const limit = template ? Math.min(template.available, maxQuantity) : 0;
  const count = Number(quantity);
  const validQuantity = Number.isInteger(count) && count >= 1 && count <= limit;
  const totalPairs = template?.sizes.reduce((pairs, row) => pairs + row.pairs, 0) ?? 0;
  const soldOut = offer.templates.every(item => item.available <= 0);
  const change = (next: number) => setQuantity(String(Math.min(Math.max(next, 1), Math.max(limit, 1))));

  const blocked = offer.buyerEnabled === false;
  const checkoutHref = `/representante/comprar-kit/checkout?${new URLSearchParams({ kit: offer.kitId, ficha: selected, qtd: String(count) })}`;

  return (
    <article className={soldOut ? "representative-grade-card is-sold-out" : "representative-grade-card"}
      aria-disabled={soldOut || undefined}>
      <header>
        <h3>{offer.name}</h3>
        {soldOut && <span className="representative-grade-badge">Esgotado</span>}
        {offer.description && <p className="kit-checkout-description">{offer.description}</p>}
      </header>
      <fieldset className="representative-grade-options" disabled={soldOut}>
        <legend>Ficha</legend>
        {offer.templates.map(item => (
          <label className="representative-grade-option" key={item.code}>
            <input type="radio" name={`${groupId}-ficha`} value={item.code} checked={item.code === selected}
              disabled={item.available <= 0} onChange={() => { setSelected(item.code); setQuantity("1"); }} />
            <span><strong>{item.label}</strong><small>{availabilityLabel(item.available)}</small></span>
            <span>{formatBRL(item.unitPriceInCents)}</span>
          </label>
        ))}
      </fieldset>
      {template && <>
        <table className="representative-grade-sizes">
          <caption className="sr-only">{totalPairs} pares por ficha</caption>
          <thead><tr><th scope="col">Tamanho</th>{template.sizes.map(row => <th scope="col" key={row.size}>{row.size}</th>)}</tr></thead>
          <tbody><tr><th scope="row">Pares</th>{template.sizes.map(row => <td key={row.size}>{row.pairs}</td>)}</tr></tbody>
        </table>
        <div className="kit-checkout-buy-row">
          <div className="representative-grade-quantity">
            <label htmlFor={`${groupId}-quantity`}>Fichas</label>
            <div className="representative-grade-stepper">
              <button type="button" aria-label="Diminuir quantidade" disabled={count <= 1} onClick={() => change(count - 1)}>−</button>
              <input id={`${groupId}-quantity`} type="number" inputMode="numeric" min={1} max={limit} step={1}
                value={quantity} onChange={event => setQuantity(event.target.value)} />
              <button type="button" aria-label="Aumentar quantidade" disabled={count >= limit} onClick={() => change(count + 1)}>+</button>
            </div>
          </div>
          <p className="representative-grade-total">
            <span>Total</span>
            <strong>{validQuantity ? formatBRL(template.unitPriceInCents * count) : "—"}</strong>
          </p>
        </div>
        {validQuantity && !blocked
          ? <Link className="primary-button" href={checkoutHref}>Comprar</Link>
          : <button type="button" className="primary-button" disabled>Comprar</button>}
        {blocked
          ? <p className="representative-grade-note" role="status">Sua conta ainda não está habilitada para comprar kits.</p>
          : !validQuantity && <p className="representative-grade-note" role="status">Informe de 1 a {limit} fichas.</p>}
      </>}
      {soldOut && <>
        <p className="representative-grade-note" role="status">Todas as fichas deste kit estão esgotadas.</p>
        <button type="button" disabled>Esgotado</button>
      </>}
    </article>
  );
}

export function RepresentativeKitGrades({ offers }: { offers: GradeOffer[] }) {
  if (!offers.length) {
    return <p className="representative-kit-catalog-empty" role="status">
      Nenhum kit disponível no momento. Assim que a curti Z cadastrar um kit, ele aparece aqui.
    </p>;
  }
  return (
    <section className="representative-kit-grades" aria-labelledby="representative-kit-grades">
      <h2 id="representative-kit-grades" className="sr-only">Kits disponíveis</h2>
      <div className="representative-grade-grid">{offers.map(offer => <GradeCard key={offer.kitId} offer={offer} />)}</div>
    </section>
  );
}
