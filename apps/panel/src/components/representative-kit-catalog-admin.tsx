"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { formatBRL } from "@curtiz/domain";
import { z } from "zod";

const variantSchema = z.object({
  variantId: z.string().uuid(),
  sku: z.string(),
  color: z.string(),
  size: z.string(),
  unitPriceInCents: z.number().int().nonnegative(),
  pairsPerSku: z.number().int().min(2),
  available: z.number().int().nonnegative().nullable(),
  imageUrl: z.string(),
  imageAlt: z.string()
});
const catalogSchema = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), name: z.string(), variants: z.array(variantSchema).min(1) })),
  total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  colors: z.array(z.string()),
  sizes: z.array(z.string())
});
type Catalog = z.infer<typeof catalogSchema>;
type CatalogVariant = z.infer<typeof variantSchema>;

export function RepresentativeKitCatalogAdmin() {
  const [page, setPage] = useState<Catalog | null>(null);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [available, setAvailable] = useState(false);
  const [filters, setFilters] = useState({ query: "", color: "", size: "", available: false });
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ catalog: "true", offset: String(offset), q: filters.query,
      color: filters.color, size: filters.size, available: String(filters.available) });
    setLoading(true);
    setError("");
    void fetch(`/api/admin/resources/kits?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data: unknown = await response.json();
        const parsed = catalogSchema.safeParse(data);
        if (!response.ok || !parsed.success) {
          throw new Error(response.ok ? "A resposta do catálogo está inválida." : "Não foi possível carregar o catálogo de revenda.");
        }
        if (!controller.signal.aborted) setPage(parsed.data);
      })
      .catch(() => { if (!controller.signal.aborted) setError("Não foi possível carregar o catálogo de revenda. Tente novamente."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, offset, retry]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setFilters({ query: query.trim(), color, size, available });
  }

  function chooseVariant(productId: string, variants: CatalogVariant[], change: { color?: string; size?: string }) {
    const currentId = selectedVariants[productId];
    const current = variants.find(variant => variant.variantId === currentId) ?? variants[0];
    if (!current) return;
    let next = variants.find(variant => variant.color === (change.color ?? current.color)
      && variant.size === (change.size ?? current.size));
    if (!next && change.color) {
      next = variants.find(variant => variant.color === change.color && (variant.available ?? 0) > 0)
        ?? variants.find(variant => variant.color === change.color);
    }
    if (next) setSelectedVariants(items => ({ ...items, [productId]: next.variantId }));
  }

  return <section className="representative-kit-admin-catalog" aria-labelledby="representative-kit-admin-catalog-title">
    <header>
      <div>
        <h2 id="representative-kit-admin-catalog-title">Catálogo de revenda</h2>
        <p>Produtos ativos com variantes de kit na ficha do catálogo. Estoque, preço e fotos vêm do produto e das variantes existentes.</p>
      </div>
      <span className="representative-kit-admin-count">{loading ? "Atualizando…" : `${(page?.total ?? 0).toLocaleString("pt-BR")} produtos`}</span>
      <button type="button" className="secondary-button" disabled={loading} onClick={() => setRetry(value => value + 1)}>
        Atualizar catálogo
      </button>
    </header>

    <form className="representative-kit-admin-filters" onSubmit={search}>
      <label className="representative-kit-admin-search">
        <span>Pesquisar produto, cor ou tamanho</span>
        <input value={query} maxLength={80} onChange={event => setQuery(event.target.value)} placeholder="Ex.: chinelo bege" />
      </label>
      <label>
        <span>Cor</span>
        <select value={color} onChange={event => setColor(event.target.value)}>
          <option value="">Todas</option>
          {(page?.colors ?? []).map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>Tamanho</span>
        <select value={size} onChange={event => setSize(event.target.value)}>
          <option value="">Todos</option>
          {(page?.sizes ?? []).map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label className="representative-kit-admin-stock-filter">
        <input type="checkbox" checked={available} onChange={event => setAvailable(event.target.checked)} />
        <span>Com estoque</span>
      </label>
      <button className="secondary-button" type="submit">Buscar</button>
    </form>

    {error ? <div className="representative-kit-admin-state" role="alert">
      <p>{error}</p><button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>
    </div> : loading ? <p className="representative-kit-admin-state" role="status">Carregando catálogo de revenda…</p>
      : !page?.items.length ? <p className="representative-kit-admin-state" role="status">
        {filters.query || filters.color || filters.size || filters.available
          ? "Nenhum produto corresponde aos filtros."
          : "Nenhum produto ativo atende às regras atuais do catálogo de revenda."}
      </p> : <div className="representative-kit-admin-grid">
        {page.items.map(product => {
          const selected = product.variants.find(variant => variant.variantId === selectedVariants[product.productId])
            ?? product.variants.find(variant => (variant.available ?? 0) > 0) ?? product.variants[0];
          if (!selected) return null;
          const colors = [...new Set(product.variants.map(variant => variant.color))];
          const sizes = [...new Set(product.variants.filter(variant => variant.color === selected.color).map(variant => variant.size))];
          return <article className="representative-kit-admin-card" key={product.productId}>
            {selected.imageUrl ? <Image className="representative-kit-admin-image" src={selected.imageUrl}
              alt={selected.imageAlt || `${product.name}, ${selected.color}`} width={600} height={480} unoptimized />
              : <div className="representative-kit-admin-image representative-kit-admin-image-empty" role="img" aria-label={`Sem foto cadastrada para ${product.name}`}>Foto não cadastrada</div>}
            <div className="representative-kit-admin-card-content">
              <h3>{product.name}</h3>
              <p>{product.variants.length.toLocaleString("pt-BR")} variantes de kit</p>
              <div className="representative-kit-admin-variant-fields">
                <label><span>Cor</span><select value={selected.color} onChange={event => chooseVariant(product.productId, product.variants, { color: event.target.value })}>
                  {colors.map(option => <option key={option} value={option}>{option}</option>)}
                </select></label>
                <label><span>Tamanho</span><select value={selected.size} onChange={event => chooseVariant(product.productId, product.variants, { size: event.target.value })}>
                  {sizes.map(option => <option key={option} value={option}>{option}</option>)}
                </select></label>
              </div>
              <div className="representative-kit-admin-facts">
                <strong>{formatBRL(selected.unitPriceInCents)}</strong>
                <span>{selected.available === null ? "Estoque sem consulta" : `${selected.available.toLocaleString("pt-BR")} disponíveis`}</span>
                <span>{selected.pairsPerSku} pares por kit · tamanho {selected.size}</span>
                <span>Código da variante: {selected.sku}</span>
              </div>
              <a className="secondary-button" href={`/administracao/produtos?q=${encodeURIComponent(product.name)}`}>
                Editar produto e variantes
              </a>
            </div>
          </article>;
        })}
      </div>}

    <nav className="representative-kit-admin-pagination" aria-label="Páginas do catálogo de revenda">
      <button type="button" className="secondary-button" disabled={loading || offset === 0}
        onClick={() => setOffset(value => Math.max(0, value - 24))}>Anterior</button>
      <span>{page?.total ? `${Math.floor(offset / 24) + 1} de ${Math.ceil(page.total / 24)}` : "—"}</span>
      <button type="button" className="secondary-button" disabled={loading || page?.nextOffset === null || page?.nextOffset === undefined}
        onClick={() => { if (page?.nextOffset !== null && page?.nextOffset !== undefined) setOffset(page.nextOffset); }}>Próxima</button>
    </nav>
  </section>;
}
