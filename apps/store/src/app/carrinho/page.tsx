"use client";

import { calculateSubtotal, formatBRL } from "@curtiz/domain";
import {
  ArrowLeft,
  Check,
  LockKeyhole,
  Minus,
  PackageCheck,
  Plus,
  ShoppingBag,
  Trash2,
  Truck
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart-provider";

export default function CartPage() {
  const { hydrated, lines, changeQuantity, remove } = useCart();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const releaseRef = useRef<number | null>(null);
  const subtotal = calculateSubtotal(lines);
  const itemCount = lines.reduce((total, line) => total + line.quantity, 0);
  const qualifiesForFreeShipping = subtotal >= 14_900;
  const remainingForFreeShipping = Math.max(0, 14_900 - subtotal);

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

  return (
    <div className="container page-shell cart-page">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/">Início</Link><span>/</span><span>Carrinho</span>
      </nav>

      <div className="section-heading cart-heading">
        <div>
          <p className="eyebrow">Sua seleção</p>
          <h1>Meu carrinho</h1>
          <p>{itemCount === 1 ? "1 item selecionado" : `${itemCount} itens selecionados`}</p>
        </div>
        {hydrated && lines.length > 0 && (
          <Link className="secondary-button compact-button" href="/produtos">
            <ArrowLeft /> Continuar comprando
          </Link>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">{feedback}</p>

      {!hydrated ? (
        <CartSkeleton />
      ) : lines.length === 0 ? (
        <div className="empty-state cart-empty-state">
          <span className="empty-state-icon"><ShoppingBag /></span>
          <p className="eyebrow">Seu carrinho está esperando</p>
          <h2>Escolha algo que combine com você</h2>
          <p>Explore a coleção Curtiz e adicione seus modelos favoritos para continuar.</p>
          <Link className="primary-button" href="/produtos">
            Explorar produtos
          </Link>
        </div>
      ) : (
        <div className="cart-layout">
          <section className="cart-list" aria-label="Produtos no carrinho">
            <div className="cart-list-header">
              <span>Produto</span>
              <span>Quantidade</span>
              <span>Subtotal</span>
            </div>

            {lines.map((line) => {
              const isPending = pendingId === line.variantId;
              return (
                <article className={isPending ? "cart-item is-updating" : "cart-item"} key={line.variantId}>
                  <Link className="cart-item-image" href={line.slug ? `/produto/${line.slug}` : "/produtos"}>
                    <Image
                      src={line.image}
                      alt={line.name}
                      width={150}
                      height={120}
                      sizes="(max-width: 560px) 92px, 128px"
                    />
                  </Link>

                  <div className="cart-item-info">
                    <p className="cart-item-stock"><Check /> Em estoque</p>
                    <h2>{line.name}</h2>
                    <dl className="cart-variations">
                      <div><dt>Cor</dt><dd>{line.color}</dd></div>
                      <div><dt>Tamanho</dt><dd>{line.size}</dd></div>
                    </dl>
                    <span className="cart-unit-price">{formatBRL(line.unitPriceInCents)} cada</span>
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
                      <output aria-label={`Quantidade atual: ${line.quantity}`}>{line.quantity}</output>
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
                        completeAction(line.variantId, `${line.name} removido do carrinho.`, () =>
                          remove(line.variantId)
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

          <aside className="summary-card cart-summary">
            <h2>Resumo do pedido</h2>
            <div className="summary-line">
              <span>Subtotal ({itemCount} {itemCount === 1 ? "item" : "itens"})</span>
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

            <div className={qualifiesForFreeShipping ? "shipping-progress complete" : "shipping-progress"}>
              <Truck aria-hidden="true" />
              <div>
                <strong>
                  {qualifiesForFreeShipping
                    ? "Você ganhou frete grátis"
                    : `Faltam ${formatBRL(remainingForFreeShipping)} para o frete grátis`}
                </strong>
                <span><i style={{ width: `${Math.min(100, (subtotal / 14_900) * 100)}%` }} /></span>
              </div>
            </div>

            <Link className="primary-button full-button checkout-button" href="/checkout">
              Continuar para o checkout
            </Link>
            <p className="secure-note"><LockKeyhole /> Ambiente seguro e valores validados no servidor.</p>
          </aside>
        </div>
      )}

      <section className="cart-assurances" aria-label="Diferenciais da compra">
        <div><Truck /><span><strong>Entrega acompanhada</strong>Consulte cada etapa do pedido.</span></div>
        <div><PackageCheck /><span><strong>Troca simplificada</strong>Solicite pela sua conta.</span></div>
        <div><LockKeyhole /><span><strong>Dados protegidos</strong>Segurança em todas as etapas.</span></div>
      </section>
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
