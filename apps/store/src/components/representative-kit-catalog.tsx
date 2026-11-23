"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { formatBRL } from "@curtiz/domain";
import { readRepresentativeKitPage, representativeKitPriceRange, type RepresentativeKitPage, type RepresentativeCatalogVariant } from "../lib/representative-kit-catalog";
import type { ResaleScenario } from "../lib/representative-resale";
import { isUnknownRecord } from "../lib/unknown-data";
import { RepresentativeKitDelivery } from "./representative-kit-delivery";
import { RepresentativeKitGrades } from "./representative-kit-grades";
import { RepresentativeKitOrderHistory } from "./representative-kit-order";
import { representativeKitState } from "../lib/representative-resale-scope";

type RecipientFields = Pick<ResaleScenario, "personType" | "icmsStatus">;
type CatalogFilters = { query: string; color: string; size: string; available: boolean };

export function RepresentativeKitCatalog({ header }: { header: ReactNode }) {
  const [offset, setOffset] = useState(0), [retry, setRetry] = useState(0);
  const [page, setPage] = useState<RepresentativeKitPage | null>(null), [error, setError] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(""), [messages, setMessages] = useState<Record<string, string>>({});
  const [query, setQuery] = useState(""), [color, setColor] = useState(""), [size, setSize] = useState(""), [available, setAvailable] = useState(false);
  const [filters, setFilters] = useState<CatalogFilters>({ query: "", color: "", size: "", available: false });
  const [recipient, setRecipient] = useState<{
    [Field in keyof RecipientFields]: RecipientFields[Field] | "";
  }>({ personType: "", icmsStatus: "" });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ offset: String(offset), q: filters.query, color: filters.color,
      size: filters.size, available: String(filters.available) });
    setPage(null); setError("");
    void fetch(`/api/representatives/kits/catalog?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Não foi possível carregar os kits.");
        const data: unknown = await response.json();
        const next = readRepresentativeKitPage(data);
        if (!controller.signal.aborted) setPage(next);
      }).catch(() => { if (!controller.signal.aborted) setError("Não foi possível carregar os kits. Tente novamente."); });
    return () => controller.abort();
  }, [offset, filters, retry]);

  function updateRecipient<Field extends keyof RecipientFields>(field: Field, value: RecipientFields[Field] | "") {
    setRecipient(current => ({ ...current, [field]: value }));
    setMessages({});
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setFilters({ query: query.trim(), color, size, available });
  }

  function chooseVariant(productId: string, variants: RepresentativeCatalogVariant[], change: { color?: string; size?: string }) {
    const current = variants.find(variant => variant.variantId === selectedVariants[productId]) ?? variants[0];
    if (!current) return;
    let next = variants.find(variant => variant.color === (change.color ?? current.color)
      && variant.size === (change.size ?? current.size));
    if (!next && change.color) {
      next = variants.find(variant => variant.color === change.color && (variant.available ?? 0) > 0)
        ?? variants.find(variant => variant.color === change.color);
    }
    if (next) setSelectedVariants(items => ({ ...items, [productId]: next.variantId }));
  }

  function setQuantity(variant: RepresentativeCatalogVariant, value: number | string) {
    setQuantities(current => ({ ...current, [variant.variantId]: String(value) }));
    setMessages(current => ({ ...current, [variant.variantId]: "" }));
  }

  async function preview(variant: RepresentativeCatalogVariant) {
    if (checking) return;
    const quantity = Number(quantities[variant.variantId] ?? "1");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99 || quantity > (variant.available ?? 0)) {
      setMessages(current => ({ ...current, [variant.variantId]: "Informe uma quantidade disponível entre 1 e 99 kits." })); return;
    }
    const { personType, icmsStatus } = recipient;
    const declaredScenario = personType && icmsStatus
      ? { personType, icmsStatus, destinationState: representativeKitState, purpose: "resale" as const }
      : undefined;
    if (!declaredScenario && (personType || icmsStatus)) {
      setMessages(current => ({ ...current, [variant.variantId]: "Preencha os dois campos da prévia ou deixe ambos em branco." }));
      return;
    }
    setChecking(variant.variantId);
    try {
      const response = await fetch("/api/representatives/kits/preview", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId: variant.variantId, quantity, declaredScenario }) });
      const data: unknown = await response.json();
      if (!response.ok || !isUnknownRecord(data) || !Number.isSafeInteger(data.merchandiseTotalInCents) || !Array.isArray(data.blockers))
        throw new Error("Não foi possível conferir este kit.");
      const unavailable = data.blockers.includes("commercial_stock_unavailable");
      setMessages(current => ({ ...current, [variant.variantId]: unavailable ? "Quantidade indisponível no estoque." :
        `${quantity} kit(s): ${formatBRL(Number(data.merchandiseTotalInCents))} em produtos.` }));
    } catch { setMessages(current => ({ ...current, [variant.variantId]: "Não foi possível conferir este kit. Tente novamente." })); }
    finally { setChecking(""); }
  }

  return <section className="representative-kit-catalog">
    {header}
    {page?.orderHistoryAvailable && <RepresentativeKitOrderHistory checkoutConfigured={page.checkoutConfigured === true} />}
    <RepresentativeKitGrades />
    {page ? <>
      {page.items.length > 0 && <details className="representative-card representative-kit-fiscal-details">
        <summary>Dados fiscais para a prévia <span>Opcional · Minas Gerais</span></summary>
        <div>
          <p>Informe o perfil do comprador se quiser incluir essa simulação. Os dados não são necessários para consultar o catálogo.</p>
          <label>
            Tipo de comprador
            <select value={recipient.personType}
              onChange={event => updateRecipient("personType", event.target.value as RecipientFields["personType"] | "")}>
              <option value="">Não informar</option>
              <option value="individual">Pessoa física</option>
              <option value="business">CNPJ, incluindo MEI</option>
            </select>
          </label>
          <label>
            Situação perante o ICMS
            <select value={recipient.icmsStatus}
              onChange={event => updateRecipient("icmsStatus", event.target.value as RecipientFields["icmsStatus"] | "")}>
              <option value="">Não informar</option>
              <option value="taxpayer">Contribuinte</option>
              <option value="registration_exempt">Dispensado de inscrição estadual</option>
              <option value="non_taxpayer">Não contribuinte</option>
              <option value="unknown">Não sei informar</option>
            </select>
          </label>
        </div>
      </details>}
      <header className="representative-kit-source-heading">
        <div>
          <h2>Kits disponíveis</h2>
          <p>Escolha cor, tamanho e quantidade. O preço e o estoque acompanham a variação selecionada.</p>
        </div>
      </header>
      <form className="representative-kit-catalog-filters" onSubmit={submitFilters}>
        <label className="representative-kit-catalog-search">
          <span>Buscar kits</span>
          <input value={query} maxLength={80} onChange={event => setQuery(event.target.value)} placeholder="Produto, cor ou tamanho" />
        </label>
        <label><span>Cor</span><select value={color} onChange={event => setColor(event.target.value)}>
          <option value="">Todas as cores</option>{page.colors.map(option => <option key={option} value={option}>{option}</option>)}
        </select></label>
        <label><span>Tamanho</span><select value={size} onChange={event => setSize(event.target.value)}>
          <option value="">Todos</option>{page.sizes.map(option => <option key={option} value={option}>{option}</option>)}
        </select></label>
        <label className="representative-kit-stock-filter"><input type="checkbox" checked={available} onChange={event => setAvailable(event.target.checked)} />
          <span>Com estoque</span></label>
        <button type="submit" className="secondary-button">Buscar</button>
      </form>
      {page.items.length ? <div className="representative-kit-product-grid">{page.items.map(product => {
        const selected = product.variants.find(variant => variant.variantId === selectedVariants[product.productId])
          ?? product.variants.find(variant => (variant.available ?? 0) > 0) ?? product.variants[0];
        if (!selected) return null;
        const colors = [...new Set(product.variants.map(variant => variant.color))];
        const sizes = [...new Set(product.variants.map(variant => variant.size))];
        const quantity = Number(quantities[selected.variantId] ?? "1");
        const range = representativeKitPriceRange(product.variants);
        const validQuantity = Boolean(selected.available) && Number.isInteger(quantity) && quantity > 0
          && quantity <= (selected.available ?? 0) && quantity <= 99;
        return <article className="representative-card representative-kit-product-card" key={product.productId}>
          {selected.imageUrl ? <Image className="representative-kit-product-image" src={selected.imageUrl}
            alt={selected.imageAlt || `${product.name}, ${selected.color}`} width={720} height={576} unoptimized />
            : <div className="representative-kit-product-image representative-kit-product-image-empty" role="img"
              aria-label={`Sem foto cadastrada para ${product.name}`}>Foto não cadastrada</div>}
          <div className="representative-kit-product-content">
            <h2>{product.name}</h2>
            <fieldset className="representative-kit-chip-group">
              <legend>Cor: <strong>{selected.color}</strong></legend>
              <div>{colors.map(option => {
                const inStock = product.variants.some(variant => variant.color === option && (variant.available ?? 0) > 0);
                return <button key={option} type="button" className="representative-kit-chip" aria-pressed={option === selected.color}
                  data-soldout={!inStock || undefined} aria-label={`Cor ${option} de ${product.name}${inStock ? "" : " (esgotada)"}`}
                  onClick={() => chooseVariant(product.productId, product.variants, { color: option })}>{option}</button>;
              })}</div>
            </fieldset>
            <fieldset className="representative-kit-chip-group">
              <legend>Tamanho: <strong>{selected.size}</strong></legend>
              <div>{sizes.map(option => {
                const match = product.variants.find(variant => variant.color === selected.color && variant.size === option);
                const soldOut = !match || (match.available ?? 0) <= 0;
                return <button key={option} type="button" className="representative-kit-chip" aria-pressed={option === selected.size}
                  disabled={soldOut && option !== selected.size} data-soldout={soldOut || undefined}
                  aria-label={`Tamanho ${option} de ${product.name}${soldOut ? " (esgotado)" : ""}`}
                  onClick={() => chooseVariant(product.productId, product.variants, { size: option })}>{option}</button>;
              })}</div>
            </fieldset>
            <p className="representative-kit-pair-count">{selected.pairsPerSku} pares por kit</p>
            <strong className="representative-kit-price">{formatBRL(selected.unitPriceInCents)}</strong>
            {range.min !== range.max && <p className="representative-kit-price-range">
              Faixa do produto: {formatBRL(range.min)} a {formatBRL(range.max)}
            </p>}
            <p className="representative-kit-stock">
              {selected.available === null ? "Estoque indisponível para consulta" : `${selected.available.toLocaleString("pt-BR")} kits disponíveis`}
            </p>
            <div className="representative-kit-quantity">
              <label htmlFor={`quantity-${selected.variantId}`}>Quantidade de kits</label>
              <div className="representative-kit-stepper">
                <button type="button" aria-label="Diminuir quantidade" disabled={!selected.available || Boolean(checking) || quantity <= 1}
                  onClick={() => setQuantity(selected, quantity - 1)}>−</button>
                <input id={`quantity-${selected.variantId}`} type="number" inputMode="numeric" min={1} max={Math.min(selected.available ?? 0, 99)} step={1}
                  disabled={!selected.available || Boolean(checking)} value={quantities[selected.variantId] ?? "1"}
                  onChange={event => setQuantity(selected, event.target.value)} />
                <button type="button" aria-label="Aumentar quantidade"
                  disabled={!selected.available || Boolean(checking) || quantity >= Math.min(selected.available ?? 0, 99)}
                  onClick={() => setQuantity(selected, quantity + 1)}>+</button>
              </div>
            </div>
            <button type="button" className="primary-button" disabled={!selected.available || Boolean(checking)} onClick={() => void preview(selected)}>
              {checking === selected.variantId ? "Conferindo…" : "Conferir valor"}
            </button>
            {validQuantity && <p className="representative-kit-summary">
              Resumo: {quantity} {quantity === 1 ? "kit" : "kits"} de {selected.color}, tamanho {selected.size} ·{" "}
              <strong>{formatBRL(selected.unitPriceInCents * quantity)}</strong> em produtos
            </p>}
            {messages[selected.variantId] && <p role="status">{messages[selected.variantId]}</p>}
            {validQuantity
              ? <RepresentativeKitDelivery variantId={selected.variantId} quantity={quantity} /> : null}
            {!page.checkoutConfigured && <button type="button" className="secondary-button" disabled>Compra em homologação</button>}
          </div>
        </article>;
      })}</div> : <p className="representative-kit-catalog-empty" role="status">Nenhum kit corresponde aos filtros. Ajuste a busca ou limpe os filtros.</p>}
    </> : error ? <div role="alert" className="representative-kit-catalog-state"><p>{error}</p>
      <button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>
    </div> : <p className="representative-kit-catalog-state" role="status">Carregando kits…</p>}
    <nav className="representative-kit-catalog-pagination" aria-label="Páginas de kits">
      <button type="button" className="secondary-button" disabled={offset === 0 || !page} onClick={() => setOffset(value => Math.max(0, value - 24))}>Anterior</button>
      <span>{page?.total ? `${Math.floor(offset / 24) + 1} de ${Math.ceil(page.total / 24)}` : "—"}</span>
      <button type="button" className="secondary-button" disabled={!page || page.nextOffset === null}
        onClick={() => { if (page?.nextOffset !== null && page?.nextOffset !== undefined) setOffset(page.nextOffset); }}>Próxima</button>
    </nav>
  </section>;
}
