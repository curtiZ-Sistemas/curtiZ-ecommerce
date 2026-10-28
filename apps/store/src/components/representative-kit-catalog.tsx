"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatBRL } from "@curtiz/domain";
import { readRepresentativeKitPage, type RepresentativeKitPage } from "../lib/representative-kit-catalog";
import { isUnknownRecord } from "../lib/unknown-data";

export function RepresentativeKitCatalog({ header }: { header: ReactNode }) {
  const [offset, setOffset] = useState(0), [retry, setRetry] = useState(0);
  const [page, setPage] = useState<RepresentativeKitPage | null>(null), [error, setError] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(""), [messages, setMessages] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setError("");
    void fetch(`/api/representatives/kits/catalog?offset=${offset}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Não foi possível carregar os kits.");
        const data: unknown = await response.json();
        const next = readRepresentativeKitPage(data);
        if (!controller.signal.aborted) setPage(next);
      }).catch(() => { if (!controller.signal.aborted) setError("Não foi possível carregar os kits. Tente novamente."); });
    return () => controller.abort();
  }, [offset, retry]);
  async function preview(variantId: string) {
    if (checking) return;
    const quantity = Number(quantities[variantId] ?? "1");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      setMessages(current => ({ ...current, [variantId]: "Informe uma quantidade de kits entre 1 e 99." })); return;
    }
    setChecking(variantId);
    try {
      const response = await fetch("/api/representatives/kits/preview", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId, quantity }) });
      const data: unknown = await response.json();
      if (!response.ok || !isUnknownRecord(data) || !Number.isSafeInteger(data.merchandiseTotalInCents) || !Array.isArray(data.blockers))
        throw new Error("Não foi possível conferir este kit.");
      const unavailable = data.blockers.includes("commercial_stock_unavailable");
      setMessages(current => ({ ...current, [variantId]: unavailable ? "Quantidade indisponível no estoque." :
        `${quantity} kit(s): ${formatBRL(Number(data.merchandiseTotalInCents))} em produtos. A compra continua em homologação.` }));
    } catch { setMessages(current => ({ ...current, [variantId]: "Não foi possível conferir este kit. Tente novamente." })); }
    finally { setChecking(""); }
  }
  return <section>
    {header}
    {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>
      : !page ? <p role="status">Carregando kits…</p>
      : !page.items.length ? <p>Nenhum kit disponível nesta página.</p>
      : <div className="representative-record-grid">{page.items.map(kit => <article className="representative-card representative-kit-card" key={kit.variantId}>
        <h2>{kit.name}</h2><p>{kit.color} · Tamanho {kit.size} · {kit.pairsPerSku} pares por kit</p>
        <small style={{ overflowWrap: "anywhere" }}>{kit.sku}</small>
        <strong>{formatBRL(kit.unitPriceInCents)}</strong>
        <p>{kit.available === null ? "Estoque indisponível para consulta" : `${kit.available} kits disponíveis`}</p>
        <label htmlFor={`quantity-${kit.variantId}`}>Quantidade de kits</label>
        <input id={`quantity-${kit.variantId}`} type="number" min={1} max={Math.min(kit.available ?? 0, 99)} step={1}
          disabled={!kit.available || Boolean(checking)} value={quantities[kit.variantId] ?? "1"}
          onChange={event => { const value = event.target.value; setQuantities(current => ({ ...current, [kit.variantId]: value }));
            setMessages(current => ({ ...current, [kit.variantId]: "" })); }} />
        <button type="button" className="secondary-button" disabled={!kit.available || Boolean(checking)} onClick={() => void preview(kit.variantId)}>
          {checking === kit.variantId ? "Conferindo…" : "Conferir valor"}
        </button>
        {messages[kit.variantId] && <p role="status">{messages[kit.variantId]}</p>}
        <button type="button" className="primary-button" disabled>Compra em homologação</button>
      </article>)}</div>}
    <nav aria-label="Páginas de kits">
      <button type="button" disabled={offset === 0 || !page} onClick={() => setOffset(value => Math.max(0, value - 24))}>Anterior</button>
      <button type="button" disabled={!page || page.nextOffset === null} onClick={() => { if (page?.nextOffset !== null && page?.nextOffset !== undefined) setOffset(page.nextOffset); }}>Próxima</button>
    </nav>
  </section>;
}
