"use client";

import { formatBRL } from "@curtiz/domain";
import { useEffect, useState } from "react";
import { isUnknownRecord, readRows, readString, readNumber } from "../lib/unknown-data";
import { RepresentativeKitDelivery } from "./representative-kit-delivery";

type GradeSize = { size: string; pairs: number };
type GradeTemplate = {
  code: string;
  label: string;
  available: number;
  unitPriceInCents: number;
  sizes: GradeSize[];
};
type GradeOffer = {
  kitId: string;
  name: string;
  description: string;
  color: string;
  templates: GradeTemplate[];
};

function readGradeOffers(value: unknown): GradeOffer[] {
  if (!isUnknownRecord(value) || !Array.isArray(value.items)) throw new Error("Fichas indisponíveis.");
  return readRows(value.items).map(item => ({
    kitId: readString(item, "kitId"),
    name: readString(item, "name"),
    description: readString(item, "description"),
    color: readString(item, "color"),
    templates: readRows(item.templates).map(template => ({
      code: readString(template, "code"),
      label: readString(template, "label"),
      available: readNumber(template, "available"),
      unitPriceInCents: readNumber(template, "unitPriceInCents", readNumber(item, "unitPriceInCents")),
      sizes: readRows(template.sizes).map(size => ({ size: readString(size, "size"), pairs: readNumber(size, "pairs") }))
    }))
  }));
}

function GradeCard({ offer }: { offer: GradeOffer }) {
  const [selected, setSelected] = useState(offer.templates.find(template => template.available > 0)?.code ?? offer.templates[0]?.code ?? "");
  const [quantity, setQuantity] = useState("1");
  const template = offer.templates.find(item => item.code === selected);
  if (!template) return null;
  const totalPairs = template.sizes.reduce((pairs, row) => pairs + row.pairs, 0);

  return (
    <article className="representative-card representative-kit-card">
      <h3>{offer.name}</h3>
      <p>{offer.color}</p>
      <p>{offer.description}</p>
      <label>
        Escolher ficha
        <select value={selected} onChange={event => { setSelected(event.target.value); setQuantity("1"); }}>
          {offer.templates.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select>
      </label>
      <dl aria-label="Pares por tamanho">
        {template.sizes.map(row => (
          <div key={row.size}>
            <dt>Tamanho {row.size}</dt>
            <dd>{row.pairs} {row.pairs === 1 ? "par" : "pares"}</dd>
          </div>
        ))}
      </dl>
      <strong>{totalPairs} pares · {formatBRL(template.unitPriceInCents)}</strong>
      <p role="status">{template.available > 0 ? `${template.available} fichas disponíveis` : "Ficha sem estoque para todos os tamanhos."}</p>
      {template.available > 0 && (
        <label>Quantidade de fichas
          <input value={quantity} onChange={event => setQuantity(event.target.value)}
            type="number" min={1} max={Math.min(template.available, 99)} step={1} />
        </label>
      )}
      {Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= Math.min(template.available, 99) && (
        <RepresentativeKitDelivery key={template.code} kitId={offer.kitId} template={template.code} quantity={Number(quantity)} />
      )}
    </article>
  );
}

export function RepresentativeKitGrades() {
  const [offers, setOffers] = useState<GradeOffer[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/representatives/kits/grades", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Fichas indisponíveis.");
        const result = readGradeOffers(await response.json() as unknown);
        if (!controller.signal.aborted) setOffers(result);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [retry]);
  if (error) {
    return <div role="alert">
      <p>Não foi possível carregar as fichas.</p>
      <button type="button" className="secondary-button" onClick={() => { setError(false); setRetry(value => value + 1); }}>Tentar novamente</button>
    </div>;
  }
  if (!offers?.length) return null;
  return (
    <section aria-labelledby="representative-kit-grades">
      <h2 id="representative-kit-grades">Kits por ficha</h2>
      <div className="representative-record-grid">{offers.map(offer => <GradeCard key={offer.kitId} offer={offer} />)}</div>
    </section>
  );
}
