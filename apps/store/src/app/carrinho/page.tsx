"use client";

import { calculateSubtotal, formatBRL } from "@curtiz/domain";
import { ArrowLeft, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart-provider";
import { CartRecommendations } from "@/components/cart-recommendations";
import type { CartVariantSelection } from "@/lib/cart-variant";
import { trackIntelligence } from "@/lib/intelligence-client";

const isCartVariant = (value: unknown): value is CartVariantSelection => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const variant = value as Record<string, unknown>;
  return (
    typeof variant.id === "string" &&
    typeof variant.color === "string" &&
    typeof variant.size === "string" &&
    Number.isInteger(variant.stock) &&
    Number(variant.stock) >= 0 &&
    Number.isInteger(variant.priceInCents) &&
    Number(variant.priceInCents) >= 0 &&
    (variant.image === undefined || typeof variant.image === "string")
  );
};

export default function CartPage() {
  const {
    hydrated,
    lines,
    selectedLines,
    selectedVariantIds,
    syncMessage,
    retrySync,
    changeQuantity,
    changeVariant,
    remove,
    removeMany,
    setSelected,
    setAllSelected,
    clear
  } = useCart();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingVariantIds, setPendingVariantIds] = useState<Set<string>>(() => new Set());
  const [variantsByProduct, setVariantsByProduct] = useState<Record<string, CartVariantSelection[]>>({});
  const [feedback, setFeedback] = useState("");
  const releaseRef = useRef<number | null>(null);
  const variantReleaseRefs = useRef(new Map<string, number>());
  const requestedProductsRef = useRef(new Set<string>());
  const selectedIdSet = new Set(selectedVariantIds);
  const subtotal = calculateSubtotal(selectedLines);
  const selectedCount = selectedLines.length;
  const allSelected = lines.length > 0 && selectedCount === lines.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(
    () => () => {
      if (releaseRef.current) window.clearTimeout(releaseRef.current);
      for (const timer of variantReleaseRefs.current.values()) window.clearTimeout(timer);
    },
    []
  );

  useEffect(() => {
    for (const line of lines) {
      if (!line.slug || line.unavailableAt || requestedProductsRef.current.has(line.productId)) continue;
      requestedProductsRef.current.add(line.productId);
      void fetch(`/api/catalog/${encodeURIComponent(line.slug)}/variants`, { cache: "no-store" })
        .then(async (response) => {
          const result: unknown = await response.json();
          if (!response.ok || !result || typeof result !== "object" || !("variants" in result)) {
            throw new Error("Não foi possível carregar os tamanhos.");
          }
          const variants = (result as { variants?: unknown }).variants;
          if (!Array.isArray(variants) || !variants.every(isCartVariant)) {
            throw new Error("Resposta de tamanhos inválida.");
          }
          setVariantsByProduct((current) => ({ ...current, [line.productId]: variants }));
        })
        .catch(() => {
          requestedProductsRef.current.delete(line.productId);
          setFeedback(`Não foi possível carregar os tamanhos de ${line.name}.`);
        });
    }
  }, [lines]);

  const completeAction = (variantId: string, message: string, action: () => void) => {
    if (pendingId) return;
    setPendingId(variantId);
    action();
    setFeedback(message);
    releaseRef.current = window.setTimeout(() => setPendingId(null), 280);
  };

  const removeSelected = () => {
    if (pendingId || selectedCount === 0) return;
    const confirmed = window.confirm(
      selectedCount === 1
        ? "Remover o produto selecionado do carrinho?"
        : `Remover os ${selectedCount} produtos selecionados do carrinho?`
    );
    if (!confirmed) return;
    const ids = selectedVariantIds;
    setPendingId("bulk-selection");
    removeMany(ids);
    setFeedback(
      ids.length === 1
        ? "1 produto removido do carrinho."
        : `${ids.length} produtos removidos do carrinho.`
    );
    releaseRef.current = window.setTimeout(() => setPendingId(null), 280);
  };

  const clearCart = () => {
    if (!window.confirm("Remover todos os itens da sacola?")) return;
    clear();
    setFeedback("Sacola esvaziada.");
  };

  const selectSize = (oldVariantId: string, productId: string, name: string, nextVariant: CartVariantSelection) => {
    if (nextVariant.stock < 1 || pendingVariantIds.has(oldVariantId) || pendingVariantIds.has(nextVariant.id)) return;
    setPendingVariantIds((current) => new Set(current).add(nextVariant.id));
    changeVariant(oldVariantId, nextVariant);
    trackIntelligence({ type: "variant_select", productId, variantId: nextVariant.id });
    setFeedback(`Tamanho de ${name} alterado para ${nextVariant.size}.`);
    const timer = window.setTimeout(() => {
      setPendingVariantIds((current) => {
        const next = new Set(current);
        next.delete(nextVariant.id);
        return next;
      });
      variantReleaseRefs.current.delete(nextVariant.id);
    }, 280);
    variantReleaseRefs.current.set(nextVariant.id, timer);
  };

  return (
    <div className="container page-shell cart-page">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/">Início</Link>
        <span>/</span>
        <span>Carrinho</span>
      </nav>

      <header className="cart-heading">
        <div className="cart-heading-toolbar">
          <Link className="cart-continue-link" href="/produtos">
            <ArrowLeft aria-hidden="true" /> Continuar comprando
          </Link>
        </div>
        <div className="cart-heading-title">
          <h1>Meu carrinho</h1>
        </div>
      </header>

      {hydrated && lines.length > 0 && (
        <div className="cart-selection-toolbar" role="group" aria-label="Seleção do carrinho">
          <CartSelectAll
            allSelected={allSelected}
            someSelected={someSelected}
            onChange={setAllSelected}
          />
          <span aria-live="polite">
            {selectedCount} de {lines.length} selecionado{selectedCount === 1 ? "" : "s"}
          </span>
          <div className="cart-selection-actions">
            <button
              className="cart-remove-selected"
              type="button"
              onClick={removeSelected}
              disabled={selectedCount === 0 || pendingId !== null}
            >
              Remover selecionados
            </button>
            <button className="cart-clear-all" type="button" onClick={clearCart}>
              Limpar carrinho
            </button>
          </div>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {feedback}
      </p>
      {syncMessage && (
        <div className="cart-sync-notice" role="status">
          <span>{syncMessage}</span>
          <button type="button" onClick={retrySync}>
            Tentar novamente
          </button>
        </div>
      )}

      {!hydrated ? (
        <CartSkeleton />
      ) : lines.length === 0 ? (
        <div className="empty-state cart-empty-state">
          <span className="empty-state-icon">
            <ShoppingBag />
          </span>
          <h2>Sua sacola está vazia.</h2>
          <p>Explore a coleção curti Z e adicione seus modelos favoritos para continuar.</p>
          <Link className="primary-button" href="/produtos">
            Continuar comprando
          </Link>
        </div>
      ) : (
        <div className="cart-layout">
          <div className="cart-main-column">
            <section className="cart-list" aria-label="Produtos no carrinho">
              {lines.map((line) => {
                const selected = selectedIdSet.has(line.variantId);
                const sizeVariants = (variantsByProduct[line.productId] ?? []).filter(
                  (variant) => variant.color === line.color
                );
                const isPending =
                  pendingId === line.variantId || (pendingId === "bulk-selection" && selected);
                const itemClassName = [
                  "cart-item",
                  line.unavailableAt ? "is-unavailable" : "",
                  selected ? "is-selected" : "",
                  isPending ? "is-updating" : ""
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <article
                    className={itemClassName}
                    data-testid="cart-item"
                    key={line.variantId}
                  >
                    <label className="cart-selection-control">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) =>
                          setSelected(line.variantId, event.currentTarget.checked)
                        }
                        disabled={isPending || Boolean(line.unavailableAt)}
                      />
                      <span className="sr-only">Selecionar {line.name}</span>
                    </label>
                    <Link
                      className="cart-item-image"
                      href={!line.unavailableAt && line.slug ? `/produto/${line.slug}` : "/produtos"}
                    >
                      <Image
                        src={line.image}
                        alt={line.name}
                        width={150}
                        height={120}
                        sizes="(max-width: 340px) 86px, (max-width: 700px) 96px, 112px"
                        onError={(event) => { if (line.unavailableAt && !event.currentTarget.src.endsWith("/icon.svg")) { event.currentTarget.srcset = ""; event.currentTarget.src = "/icon.svg"; } }}
                      />
                    </Link>

                    <div className="cart-item-info">
                      <h2>{line.name}</h2>
                      <p className="cart-variation">
                        <span>{line.color} · </span>
                        <label>
                          <span className="sr-only">Tamanho de {line.name}</span>
                          <select
                            className="cart-size-select"
                            value={line.variantId}
                            onChange={(event) => {
                              const nextVariant = sizeVariants.find(
                                (variant) => variant.id === event.currentTarget.value
                              );
                              if (nextVariant) selectSize(line.variantId, line.productId, line.name, nextVariant);
                            }}
                            disabled={
                              Boolean(line.unavailableAt) ||
                              sizeVariants.length < 2 ||
                              pendingVariantIds.has(line.variantId)
                            }
                            aria-label={`Tamanho de ${line.name}`}
                          >
                            {sizeVariants.length === 0 ? (
                              <option value={line.variantId}>{line.size}</option>
                            ) : sizeVariants.map((variant) => (
                              <option value={variant.id} disabled={variant.stock < 1} key={variant.id}>
                                {variant.size}{variant.stock < 1 ? " — indisponível" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                      </p>
                      {line.unavailableAt && <p className="cart-unavailable-notice" role="status">Este produto não existe mais. Será removido do carrinho em até 3 dias.</p>}
                    </div>

                    <div className="cart-item-purchase">
                      <strong className="cart-item-price">
                        {formatBRL(line.unitPriceInCents)}
                      </strong>
                      <div className="quantity-control">
                        <button
                          type="button"
                          onClick={() =>
                            completeAction(
                              line.variantId,
                              `Quantidade de ${line.name} atualizada para ${Math.max(1, line.quantity - 1)}.`,
                              () => changeQuantity(line.variantId, line.quantity - 1)
                            )
                          }
                          disabled={Boolean(line.unavailableAt) || pendingId !== null || line.quantity <= 1}
                          aria-label={`Diminuir quantidade de ${line.name}`}
                        >
                          <Minus />
                        </button>
                        <output aria-label={`Quantidade atual: ${line.quantity}`}>
                          {line.quantity}
                        </output>
                        <button
                          type="button"
                          onClick={() =>
                            completeAction(
                              line.variantId,
                              `Quantidade de ${line.name} atualizada para ${line.quantity + 1}.`,
                              () => changeQuantity(line.variantId, line.quantity + 1)
                            )
                          }
                          disabled={Boolean(line.unavailableAt) || pendingId !== null || line.quantity >= (line.maxQuantity ?? 10)}
                          aria-label={`Aumentar quantidade de ${line.name}`}
                        >
                          <Plus />
                        </button>
                      </div>
                      <button
                        className="remove-button"
                        type="button"
                        aria-label={`Remover ${line.name}`}
                        onClick={() =>
                          completeAction(
                            line.variantId,
                            `${line.name} removido do carrinho.`,
                            () => remove(line.variantId)
                          )
                        }
                        disabled={pendingId !== null}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>

          </div>

          <aside className="summary-card cart-summary">
            <h2>Resumo do pedido</h2>
            <div className="summary-line">
              <span>Produtos selecionados</span>
              <strong>{selectedCount}</strong>
            </div>
            <div className="summary-line">
              <span>Subtotal</span>
              <strong data-testid="selected-subtotal">{formatBRL(subtotal)}</strong>
            </div>
            <div className="summary-line">
              <span>Frete</span>
              <span>Calculado no checkout</span>
            </div>

            {selectedCount > 0 ? (
              <Link className="primary-button full-button checkout-button" href="/checkout">
                Continuar para o checkout
              </Link>
            ) : (
              <button className="primary-button full-button checkout-button" type="button" disabled>
                Selecione um produto
              </button>
            )}
          </aside>

          <div className="cart-mobile-summary" aria-label="Resumo do carrinho">
            <div className="cart-mobile-total">
              <span>Total</span>
              <strong data-testid="mobile-selected-total">{formatBRL(subtotal)}</strong>
            </div>
            {selectedCount > 0 ? (
              <Link className="primary-button" href="/checkout">
                Comprar ({selectedCount})
              </Link>
            ) : (
              <button className="primary-button" type="button" disabled>
                Comprar (0)
              </button>
            )}
          </div>
        </div>
      )}
      {hydrated && lines.length > 0 && <CartRecommendations lines={lines} />}
    </div>
  );
}

function CartSelectAll({
  allSelected,
  someSelected,
  onChange
}: {
  allSelected: boolean;
  someSelected: boolean;
  onChange: (selected: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <label className="cart-select-all">
      <input
        ref={inputRef}
        type="checkbox"
        checked={allSelected}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>Selecionar todos</span>
    </label>
  );
}

function CartSkeleton() {
  return (
    <div className="cart-layout" aria-busy="true" aria-label="Carregando carrinho">
      <div className="cart-list">
        {[0, 1].map((item) => (
          <div className="cart-item cart-item-skeleton" key={item}>
            <div className="skeleton skeleton-cart-image" />
            <div>
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line short" />
            </div>
          </div>
        ))}
      </div>
      <div className="summary-card">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
      </div>
    </div>
  );
}
