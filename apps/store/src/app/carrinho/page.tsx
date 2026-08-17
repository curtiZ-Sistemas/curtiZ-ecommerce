"use client";

import { calculateSubtotal, formatBRL } from "@curtiz/domain";
import { ArrowLeft, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart-provider";
import { CartRecommendations } from "@/components/cart-recommendations";

export default function CartPage() {
  const { hydrated, lines, syncMessage, retrySync, changeQuantity, remove, clear } = useCart();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const releaseRef = useRef<number | null>(null);
  const subtotal = calculateSubtotal(lines);
  const itemCount = lines.reduce((total, line) => total + line.quantity, 0);
  const selectedVariantIds = lines
    .filter((line) => selectedIds.has(line.variantId))
    .map((line) => line.variantId);

  useEffect(
    () => () => {
      if (releaseRef.current) window.clearTimeout(releaseRef.current);
    },
    []
  );

  const completeAction = (variantId: string, message: string, action: () => void) => {
    if (pendingId) return;
    setPendingId(variantId);
    action();
    setFeedback(message);
    releaseRef.current = window.setTimeout(() => setPendingId(null), 280);
  };

  const leaveSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelection = (variantId: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(variantId);
      else next.delete(variantId);
      return next;
    });
  };

  const removeSelected = () => {
    if (pendingId || selectedVariantIds.length === 0) return;
    const ids = selectedVariantIds;
    setPendingId("bulk-selection");
    ids.forEach(remove);
    setFeedback(
      ids.length === 1
        ? "1 produto removido do carrinho."
        : `${ids.length} produtos removidos do carrinho.`
    );
    leaveSelectionMode();
    releaseRef.current = window.setTimeout(() => setPendingId(null), 280);
  };

  const clearCart = () => {
    if (!window.confirm("Remover todos os itens da sacola?")) return;
    clear();
    leaveSelectionMode();
    setFeedback("Sacola esvaziada.");
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
          {hydrated && lines.length > 0 && (
            <button
              className="cart-manage-button"
              type="button"
              onClick={() => {
                if (selectionMode) return;
                setSelectionMode(true);
                setSelectedIds(new Set());
                setFeedback("Selecione os produtos que deseja remover.");
              }}
              aria-label="Selecionar produtos para remover"
              aria-pressed={selectionMode}
              title="Selecionar produtos para remover"
            >
              <Trash2 aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="cart-heading-title">
          <h1>Meu carrinho</h1>
          <p>{itemCount === 1 ? "1 item selecionado" : `${itemCount} itens selecionados`}</p>
        </div>
      </header>

      {selectionMode && lines.length > 0 && (
        <div className="cart-selection-toolbar" role="group" aria-label="Ações de seleção">
          <span>
            {selectedVariantIds.length === 0
              ? "Selecione os produtos"
              : selectedVariantIds.length === 1
                ? "1 produto selecionado"
                : `${selectedVariantIds.length} produtos selecionados`}
          </span>
          <div>
            <button
              className="cart-remove-selected"
              type="button"
              onClick={removeSelected}
              disabled={selectedVariantIds.length === 0 || pendingId !== null}
            >
              Remover selecionados
            </button>
            <button className="cart-clear-all" type="button" onClick={clearCart}>
              Limpar tudo
            </button>
            <button className="cart-cancel-selection" type="button" onClick={leaveSelectionMode}>
              Cancelar
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
            <section
              className={selectionMode ? "cart-list is-selecting" : "cart-list"}
              aria-label="Produtos no carrinho"
            >
              <div className="cart-list-header">
                <span>Produto</span>
                <span>Quantidade</span>
                <span>Subtotal</span>
              </div>

              {lines.map((line) => {
                const selected = selectedIds.has(line.variantId);
                const isPending =
                  pendingId === line.variantId || (pendingId === "bulk-selection" && selected);
                const itemClassName = [
                  "cart-item",
                  selectionMode ? "is-selecting" : "",
                  selected ? "is-selected" : "",
                  isPending ? "is-updating" : ""
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <article className={itemClassName} key={line.variantId}>
                    {selectionMode && (
                      <label className="cart-selection-control">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) =>
                            toggleSelection(line.variantId, event.currentTarget.checked)
                          }
                          disabled={isPending}
                        />
                        <span className="sr-only">Selecionar {line.name}</span>
                      </label>
                    )}
                    <Link
                      className="cart-item-image"
                      href={line.slug ? `/produto/${line.slug}` : "/produtos"}
                    >
                      <Image
                        src={line.image}
                        alt={line.name}
                        width={150}
                        height={120}
                        sizes="(max-width: 560px) 92px, 128px"
                      />
                    </Link>

                    <div className="cart-item-info">
                      <h2>{line.name}</h2>
                      <dl className="cart-variations">
                        <div>
                          <dt>Cor</dt>
                          <dd>{line.color}</dd>
                        </div>
                        <div>
                          <dt>Tamanho</dt>
                          <dd>{line.size}</dd>
                        </div>
                      </dl>
                      <span className="cart-unit-price">
                        {formatBRL(line.unitPriceInCents)} cada
                      </span>
                    </div>

                    <div className="cart-item-quantity">
                      <span className="mobile-field-label">Quantidade</span>
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
                          disabled={isPending || line.quantity <= 1}
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
                          disabled={isPending || line.quantity >= (line.maxQuantity ?? 10)}
                          aria-label={`Aumentar quantidade de ${line.name}`}
                        >
                          <Plus />
                        </button>
                      </div>
                      <button
                        className="remove-button"
                        type="button"
                        onClick={() =>
                          completeAction(
                            line.variantId,
                            `${line.name} removido do carrinho.`,
                            () => {
                              remove(line.variantId);
                              setSelectedIds((current) => {
                                const next = new Set(current);
                                next.delete(line.variantId);
                                return next;
                              });
                              if (lines.length === 1) setSelectionMode(false);
                            }
                          )
                        }
                        disabled={isPending}
                      >
                        <Trash2 /> Remover
                      </button>
                    </div>

                    <div className="cart-item-total">
                      <span className="mobile-field-label">Subtotal</span>
                      <strong>{formatBRL(line.unitPriceInCents * line.quantity)}</strong>
                    </div>
                  </article>
                );
              })}
            </section>

            <CartRecommendations lines={lines} />
          </div>

          <aside className="summary-card cart-summary">
            <h2>Resumo do pedido</h2>
            <div className="summary-line">
              <span>
                Subtotal ({itemCount} {itemCount === 1 ? "item" : "itens"})
              </span>
              <strong>{formatBRL(subtotal)}</strong>
            </div>
            <div className="summary-line">
              <span>Frete</span>
              <span>Calculado no checkout</span>
            </div>
            <div className="summary-line summary-total">
              <span>Total parcial</span>
              <strong>{formatBRL(subtotal)}</strong>
            </div>

            <Link className="primary-button full-button checkout-button" href="/checkout">
              Continuar para o checkout
            </Link>
          </aside>

          <div className="cart-mobile-summary" aria-label="Resumo do carrinho">
            <div>
              <span>Total</span>
              <strong>{formatBRL(subtotal)}</strong>
            </div>
            <Link className="primary-button" href="/checkout">
              Comprar
            </Link>
          </div>
        </div>
      )}
    </div>
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
