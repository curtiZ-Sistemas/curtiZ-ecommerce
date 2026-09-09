"use client";

import { calculateSubtotal, formatBRL, type CartLine } from "@curtiz/domain";
import { ArrowLeft, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart-provider";
import { CartRecommendations } from "@/components/cart-recommendations";

export default function CartPage() {
  const {
    hydrated,
    lines,
    selectedLines,
    selectedVariantIds,
    syncMessage,
    retrySync,
    changeQuantity,
    removeMany,
    restore,
    setSelected,
    setAllSelected,
    clear
  } = useCart();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [removed, setRemoved] = useState<{ lines: CartLine[]; selectedIds: string[] } | null>(null);
  const clearDialogRef = useRef<HTMLDialogElement>(null);
  const releaseRef = useRef<number | null>(null);
  const selectedIdSet = new Set(selectedVariantIds);
  const subtotal = calculateSubtotal(selectedLines);
  const selectedCount = selectedLines.length;
  const allSelected = lines.length > 0 && selectedCount === lines.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(
    () => () => {
      if (releaseRef.current) window.clearTimeout(releaseRef.current);
    },
    []
  );

  useEffect(() => {
    const forgetUndo = () => setRemoved(null);
    window.addEventListener("curtiz-session-state-cleared", forgetUndo);
    return () => window.removeEventListener("curtiz-session-state-cleared", forgetUndo);
  }, []);

  const completeAction = (variantId: string, message: string, action: () => void) => {
    if (pendingId) return;
    setPendingId(variantId);
    action();
    setFeedback(message);
    releaseRef.current = window.setTimeout(() => setPendingId(null), 280);
  };

  const removeSelected = () => {
    if (pendingId || selectedCount === 0) return;
    removeWithUndo(selectedVariantIds);
  };

  const removeWithUndo = (ids: string[]) => {
    const snapshot = lines.filter((line) => ids.includes(line.variantId));
    setRemoved((previous) => ({
      lines: [...(previous?.lines ?? []), ...snapshot].filter((line, index, list) => list.findIndex((item) => item.variantId === line.variantId) === index),
      selectedIds: [...new Set([...(previous?.selectedIds ?? []), ...selectedVariantIds.filter((id) => ids.includes(id))])]
    }));
    removeMany(ids);
    setFeedback(snapshot.length === 1 ? "Produto removido." : `${snapshot.length} produtos removidos.`);
  };

  const clearCart = () => {
    setRemoved({ lines: [...lines], selectedIds: [...selectedVariantIds] });
    clear();
    clearDialogRef.current?.close();
    setFeedback("Carrinho esvaziado.");
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
            <button className="cart-clear-all" type="button" onClick={() => clearDialogRef.current?.showModal()}>
              Limpar carrinho
            </button>
          </div>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {feedback}
      </p>
      <dialog ref={clearDialogRef} className="cart-clear-dialog" aria-labelledby="clear-cart-title">
        <h2 id="clear-cart-title">Limpar carrinho?</h2>
        <p>Todos os produtos serão removidos. Você pode desfazer depois.</p>
        <div className="empty-state-actions">
          <button className="secondary-button" type="button" autoFocus onClick={() => clearDialogRef.current?.close()}>Manter produtos</button>
          <button className="primary-button" type="button" onClick={clearCart}>Sim, limpar carrinho</button>
        </div>
      </dialog>
      {removed && <div className="cart-undo-toast" role="status">
        <span>{removed.lines.length === 1 ? "Produto removido" : `${removed.lines.length} produtos removidos`}</span>
        <button type="button" onClick={() => {
          restore(removed.lines, removed.selectedIds);
          setRemoved(null);
          setFeedback("Produtos restaurados no carrinho.");
        }}>Desfazer</button>
        <button type="button" aria-label="Fechar aviso de remoção" onClick={() => setRemoved(null)}>×</button>
      </div>}
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
          <h2>Seu carrinho está vazio</h2>
          <p>Explore a coleção curti Z e adicione seus modelos favoritos para continuar.</p>
          <Link className="primary-button" href="/produtos">
            Encontrar minha pegada
          </Link>
        </div>
      ) : (
        <div className="cart-layout">
          <div className="cart-main-column">
            <section className="cart-list" aria-label="Produtos no carrinho">
              {lines.map((line) => {
                const selected = selectedIdSet.has(line.variantId);
                const isPending =
                  pendingId === line.variantId || (pendingId === "bulk-selection" && selected);
                const itemClassName = [
                  "cart-item",
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
                        disabled={isPending}
                      />
                      <span className="sr-only">Selecionar {line.name}</span>
                    </label>
                    <Link
                      className="cart-item-image"
                      href={line.slug ? `/produto/${line.slug}` : "/produtos"}
                    >
                      <Image
                        src={line.image}
                        alt={line.name}
                        width={150}
                        height={120}
                        sizes="(max-width: 340px) 86px, (max-width: 700px) 96px, 112px"
                      />
                    </Link>

                    <div className="cart-item-info">
                      <h2>{line.name}</h2>
                      <p className="cart-variation">{line.color} · {line.size}</p>
                      <small>Subtotal: {formatBRL(line.unitPriceInCents * line.quantity)}</small>
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
                          disabled={pendingId !== null || line.quantity <= 1}
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
                          disabled={pendingId !== null || line.quantity >= (line.maxQuantity ?? 10)}
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
                            () => removeWithUndo([line.variantId])
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
