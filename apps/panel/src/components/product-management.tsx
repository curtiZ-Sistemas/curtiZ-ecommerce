"use client";

import { Archive, Boxes, LoaderCircle, PackagePlus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filterManagedProducts, type ManagedProduct } from "@/lib/product-management";

type CatalogResponse = {
  products?: ManagedProduct[];
  message?: string;
};

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);

export function ProductManagement() {
  const [products, setProducts] = useState<ManagedProduct[]>([]);
  const [filter, setFilter] = useState<"all" | "out">("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<ManagedProduct | null>(null);
  const quantities = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/catalog/products", { cache: "no-store" });
      const result = (await response.json()) as CatalogResponse;
      if (!response.ok) throw new Error(result.message);
      setProducts(result.products ?? []);
      setMessage("");
    } catch {
      setMessage("Não foi possível carregar os produtos agora.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleProducts = useMemo(
    () => filterManagedProducts(products, filter, query),
    [filter, products, query]
  );

  const execute = async (body: Record<string, unknown>, key: string) => {
    if (pending) return false;
    setPending(key);
    setMessage("");
    try {
      const response = await fetch("/api/catalog/products", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = (await response.json()) as CatalogResponse;
      setMessage(result.message ?? (response.ok ? "Alteração concluída." : "A alteração falhou."));
      if (response.ok) await load();
      return response.ok;
    } catch {
      setMessage("Não foi possível concluir a alteração agora.");
      return false;
    } finally {
      setPending("");
    }
  };

  return (
    <section className="panel-card product-management">
      <div className="page-heading">
        <div>
          <h2>Produtos</h2>
          <p>Gerencie disponibilidade e estoque por variação.</p>
        </div>
        <div className="product-filter-tabs" role="group" aria-label="Filtrar produtos">
          <button
            className={filter === "all" ? "secondary-button active" : "secondary-button"}
            type="button"
            onClick={() => setFilter("all")}
          >
            Todos
          </button>
          <button
            className={filter === "out" ? "secondary-button active" : "secondary-button"}
            type="button"
            onClick={() => setFilter("out")}
          >
            Produtos sem estoque
          </button>
        </div>
      </div>

      <label className="product-search">
        <Search aria-hidden="true" />
        <span className="sr-only">Buscar produtos</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar nome ou SKU"
        />
      </label>

      {message && <p className="form-message" role="status">{message}</p>}
      {loading ? (
        <div className="operational-empty"><LoaderCircle className="spin" /><strong>Carregando produtos</strong></div>
      ) : visibleProducts.length === 0 ? (
        <div className="operational-empty"><Boxes /><strong>Nenhum produto encontrado</strong></div>
      ) : (
        <div className="managed-product-list">
          {visibleProducts.map((product) => (
            <article className="managed-product" key={product.id}>
              <header>
                <div>
                  <h3>{product.name}</h3>
                  <span>{formatBRL(product.priceInCents)} · {product.status === "archived" ? "Arquivado" : "Ativo"}</span>
                </div>
                <div>
                  <strong>{product.stock}</strong>
                  <span>disponível para venda</span>
                </div>
                {product.status !== "archived" && (
                  <button
                    className="secondary-button danger-button"
                    type="button"
                    onClick={() => setArchiveTarget(product)}
                    disabled={Boolean(pending)}
                  >
                    <Archive /> Excluir produto
                  </button>
                )}
              </header>
              <div className="managed-variant-list">
                {product.variants.map((variant) => (
                  <div className="managed-variant" key={variant.id}>
                    <div>
                      <strong>{variant.sku}</strong>
                      <span>{variant.color} · {variant.size}</span>
                    </div>
                    <span>Disponível: <strong>{variant.available}</strong></span>
                    <span>Reservado: <strong>{variant.reserved}</strong></span>
                    <label>
                      <span>Adicionar</span>
                      <input
                        ref={(element) => {
                          quantities.current[variant.id] = element;
                        }}
                        type="number"
                        min="1"
                        max="99999"
                        defaultValue="1"
                        inputMode="numeric"
                        aria-label={`Quantidade para ${variant.sku}`}
                      />
                    </label>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={Boolean(pending) || !variant.active || product.status === "archived"}
                      onClick={() => {
                        const quantity = Number(quantities.current[variant.id]?.value);
                        if (!Number.isInteger(quantity) || quantity < 1) {
                          setMessage("Informe uma quantidade inteira maior que zero.");
                          return;
                        }
                        void execute(
                          {
                            action: "restock",
                            productId: product.id,
                            variantId: variant.id,
                            quantity
                          },
                          variant.id
                        );
                      }}
                    >
                      {pending === variant.id ? <LoaderCircle className="spin" /> : <PackagePlus />}
                      Repor
                    </button>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      {archiveTarget && (
        <div className="confirm-backdrop" role="presentation">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="archive-product-title"
          >
            <h2 id="archive-product-title">Excluir produto?</h2>
            <p>
              {archiveTarget.name} deixará de aparecer na loja. Pedidos antigos continuarão preservados.
            </p>
            <div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setArchiveTarget(null)}
                disabled={Boolean(pending)}
              >
                Não
              </button>
              <button
                className="primary-button danger-button"
                type="button"
                disabled={Boolean(pending)}
                onClick={() => {
                  const target = archiveTarget;
                  void execute({ action: "archive", productId: target.id }, target.id).then((ok) => {
                    if (ok) setArchiveTarget(null);
                  });
                }}
              >
                {pending === archiveTarget.id && <LoaderCircle className="spin" />}
                Sim
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
