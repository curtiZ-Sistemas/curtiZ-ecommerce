"use client";

import { formatBRL, formatBRLInput, parseBRLToCents } from "@curtiz/domain";
import { LoaderCircle, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { kitGradePriceFields, kitGradeStockFields } from "@/lib/admin-resources";
import { kitNameFor, kitSuggestedValues } from "@/lib/kit-defaults";

export type KitSource = { productId: string; name: string; color: string };
export type KitProductGroup = { productId: string; name: string; colors: string[] };
export type KitBulkOutcome = { name: string; status: "created" | "skipped" | "error"; message?: string };

export type KitSheetValues = Record<string, string>;

export function groupKitSources(sources: readonly KitSource[]): KitProductGroup[] {
  const groups = new Map<string, KitProductGroup>();
  for (const source of sources) {
    const group = groups.get(source.productId) ?? { productId: source.productId, name: source.name, colors: [] };
    if (!group.colors.includes(source.color)) group.colors.push(source.color);
    groups.set(source.productId, group);
  }
  return [...groups.values()];
}

export function suggestedSheetValues(productName: string): KitSheetValues {
  const suggested = kitSuggestedValues(productName);
  const values: KitSheetValues = {};
  for (const field of kitGradePriceFields) values[field.key] = formatBRLInput(suggested[field.key]);
  for (const field of kitGradeStockFields) values[field.key] = String(suggested[field.key]);
  return values;
}

const sheetLabels = ["Padrão", "Reposição baixa", "Reposição alta"];

function sheetSummary(values: KitSheetValues): string {
  return kitGradePriceFields.map((field, index) => {
    let cents = 0;
    try { cents = parseBRLToCents(values[field.key] ?? ""); } catch { cents = 0; }
    return `${sheetLabels[index]} ${formatBRL(cents)} × ${values[kitGradeStockFields[index]?.key ?? ""] ?? 0}`;
  }).join(" · ");
}

// Previews the kits that will be created: one per color, with the three sheets already filled in.
export function KitQuickPreview({
  group,
  existing,
  values
}: {
  group: KitProductGroup;
  existing: ReadonlySet<string>;
  values: KitSheetValues;
}) {
  const pending = group.colors.filter(color => !existing.has(`${group.productId}|${color}`));
  return (
    <div className="kit-quick-preview">
      <p className="kit-grade-help">
        {pending.length} de {group.colors.length} cores ainda não têm kit.
      </p>
      <ul className="kit-quick-list">
        {group.colors.map(color => {
          const exists = existing.has(`${group.productId}|${color}`);
          return (
            <li key={color} className={exists ? "kit-quick-item kit-quick-item-exists" : "kit-quick-item"}>
              <strong>{kitNameFor(group.name, color)}</strong>
              <span>{exists ? "já existe" : sheetSummary(values)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function KitBulkResult({ outcomes }: { outcomes: readonly KitBulkOutcome[] }) {
  const created = outcomes.filter(outcome => outcome.status === "created").length;
  const skipped = outcomes.filter(outcome => outcome.status === "skipped").length;
  const failed = outcomes.filter(outcome => outcome.status === "error");
  return (
    <div role="status" className="kit-quick-result">
      <p><strong>{created} criado(s)</strong> · {skipped} pulado(s) · {failed.length} com erro</p>
      {failed.length > 0 && (
        <ul>{failed.map(outcome => <li key={outcome.name}>{outcome.name}: {outcome.message ?? "Erro ao criar."}</li>)}</ul>
      )}
    </div>
  );
}

async function readItems(url: string, signal: AbortSignal): Promise<Record<string, unknown>[]> {
  const response = await fetch(url, { cache: "no-store", signal });
  const body: unknown = await response.json().catch(() => null);
  const items = body && typeof body === "object" ? (body as { items?: unknown }).items : null;
  if (!response.ok || !Array.isArray(items)) throw new Error("unavailable");
  return items.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
}

export function KitQuickCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [sources, setSources] = useState<KitSource[] | null>(null);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [productId, setProductId] = useState("");
  const [values, setValues] = useState<KitSheetValues>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [outcomes, setOutcomes] = useState<KitBulkOutcome[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSources(null);
    setLoadError(false);
    void Promise.all([
      readItems("/api/admin/resources/kits?gradeSources=true", controller.signal),
      readItems("/api/admin/resources/kits/bulk", controller.signal)
    ])
      .then(([sourceItems, existingItems]) => {
        if (controller.signal.aborted) return;
        setSources(sourceItems.flatMap(item =>
          typeof item.productId === "string" && typeof item.name === "string" && typeof item.color === "string"
            ? [{ productId: item.productId, name: item.name, color: item.color }]
            : []));
        setExisting(new Set(existingItems.flatMap(item =>
          typeof item.productId === "string" && typeof item.color === "string" ? [`${item.productId}|${item.color}`] : [])));
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, [retry]);

  const groups = useMemo(() => groupKitSources(sources ?? []), [sources]);
  const group = groups.find(item => item.productId === productId);
  const toCreate = group ? group.colors.filter(color => !existing.has(`${group.productId}|${color}`)) : [];

  const choose = (id: string) => {
    setProductId(id);
    setError("");
    setOutcomes(null);
    const selected = groups.find(item => item.productId === id);
    if (selected) setValues(suggestedSheetValues(selected.name));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !group || toCreate.length === 0) return;
    setError("");
    const sheet: Record<string, number> = {};
    try {
      for (const field of kitGradePriceFields) sheet[field.key] = parseBRLToCents(values[field.key] ?? "");
      for (const field of kitGradeStockFields) {
        const stock = Number((values[field.key] ?? "").trim());
        if (!Number.isInteger(stock) || stock < 0) throw new Error("stock");
        sheet[field.key] = stock;
      }
    } catch {
      setError("Revise os preços e estoques das fichas.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/admin/resources/kits/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: toCreate.map(color => ({ name: kitNameFor(group.name, color), gradeSource: `${group.productId}|${color}`, ...sheet }))
        })
      });
      const body = await response.json().catch(() => null) as { outcomes?: KitBulkOutcome[]; message?: string } | null;
      if (!response.ok && !body?.outcomes) throw new Error(body?.message || "Não foi possível criar os kits.");
      const result = body?.outcomes ?? [];
      setOutcomes(result);
      setExisting(current => {
        const next = new Set(current);
        for (const color of toCreate) {
          if (result.some(outcome => outcome.name === kitNameFor(group.name, color) && outcome.status !== "error")) {
            next.add(`${group.productId}|${color}`);
          }
        }
        return next;
      });
      if (result.some(outcome => outcome.status === "created")) onCreated();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível criar os kits.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="admin-modal-backdrop">
      <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="kit-quick-title">
        <header>
          <h2 id="kit-quick-title">Cadastro rápido de kits</h2>
          <button type="button" onClick={onClose} aria-label="Fechar"><X /></button>
        </header>
        <form className="kit-form" onSubmit={event => void submit(event)}>
          <div className="admin-form-grid kit-form-grid">
            <div className="wide kit-form-source">
              <label>
                <span>Produto de referência *</span>
                {sources ? (
                  <select value={productId} onChange={event => choose(event.target.value)}>
                    <option value="">Selecione o produto</option>
                    {groups.map(item => (
                      <option key={item.productId} value={item.productId}>{item.name} ({item.colors.join(", ")})</option>
                    ))}
                  </select>
                ) : loadError ? (
                  <span role="alert">Não foi possível carregar os produtos de referência.</span>
                ) : <span role="status">Carregando produtos…</span>}
              </label>
              {loadError && <button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>}
              <small className="kit-form-help">Será criado um kit por cor do produto, com as 3 fichas preenchidas.</small>
            </div>
            {group && (
              <fieldset className="wide kit-grade-prices">
                <h3 className="kit-form-section-title">Fichas (valem para todos os kits)</h3>
                <div className="kit-grade-table">
                  <div className="kit-grade-head" aria-hidden="true"><span>Ficha</span><span>Preço (R$)</span><span>Estoque (kits)</span></div>
                  {kitGradePriceFields.map((field, index) => {
                    const stockKey = kitGradeStockFields[index]?.key ?? "";
                    return (
                      <div key={field.key} className="kit-grade-sheet">
                        <div className="kit-grade-name"><strong>{sheetLabels[index]}</strong></div>
                        <label className="kit-grade-cell">
                          <span className="kit-grade-cell-label">Preço (R$)</span>
                          <span className="money-field-control">
                            <span aria-hidden="true">R$</span>
                            <input
                              aria-label={`Preço ${sheetLabels[index]}`}
                              inputMode="decimal"
                              value={values[field.key] ?? ""}
                              onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}
                            />
                          </span>
                        </label>
                        <label className="kit-grade-cell">
                          <span className="kit-grade-cell-label">Estoque (kits)</span>
                          <span className="kit-grade-stock-control">
                            <input
                              aria-label={`Estoque ${sheetLabels[index]}`}
                              type="number"
                              min={0}
                              step={1}
                              value={values[stockKey] ?? ""}
                              onChange={event => setValues(current => ({ ...current, [stockKey]: event.target.value }))}
                            />
                            <span aria-hidden="true">kits</span>
                          </span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {group && <div className="wide"><KitQuickPreview group={group} existing={existing} values={values} /></div>}
            {outcomes && <div className="wide"><KitBulkResult outcomes={outcomes} /></div>}
          </div>
          {error ? <p className="admin-modal-error" role="alert">{error}</p> : null}
          <footer>
            <button className="secondary-button" type="button" onClick={onClose} disabled={pending}>Fechar</button>
            <button className="primary-button" type="submit" disabled={pending || !group || toCreate.length === 0}>
              {pending ? <LoaderCircle aria-hidden="true" /> : null}
              {toCreate.length > 0 ? `Criar ${toCreate.length} kit${toCreate.length === 1 ? "" : "s"}` : "Criar kits"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
