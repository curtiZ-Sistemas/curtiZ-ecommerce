"use client";

import { calculateSubtotal, formatBRL } from "@curtiz/domain";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/components/cart-provider";

export default function CartPage() {
  const { lines, changeQuantity, remove } = useCart();
  const subtotal = calculateSubtotal(lines);

  return (
    <div className="container page-shell">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Sua seleção</p>
          <h1>Meu carrinho</h1>
          <p>{lines.length === 1 ? "1 produto" : `${lines.length} produtos`}</p>
        </div>
      </div>
      {lines.length === 0 ? (
        <div className="empty-state">
          <ShoppingBag size={42} />
          <h2>Seu carrinho está vazio</h2>
          <p>Explore a coleção Curtiz e encontre seu próximo favorito.</p>
          <Link className="primary-button" href="/produtos">
            Ver produtos
          </Link>
        </div>
      ) : (
        <div className="cart-layout">
          <div className="cart-list">
            {lines.map((line) => (
              <article className="cart-item" key={line.variantId}>
                <Image src={line.image} alt={line.name} width={120} height={90} />
                <div>
                  <h2>{line.name}</h2>
                  <span>
                    {line.color} • {line.size}
                  </span>
                  <div className="quantity-control">
                    <button
                      onClick={() => changeQuantity(line.variantId, line.quantity - 1)}
                      aria-label="Diminuir quantidade"
                    >
                      <Minus size={16} />
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      onClick={() => changeQuantity(line.variantId, line.quantity + 1)}
                      aria-label="Aumentar quantidade"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <button
                    className="text-link"
                    onClick={() => remove(line.variantId)}
                    style={{ border: 0, background: "none", marginTop: 10, cursor: "pointer" }}
                  >
                    <Trash2 size={15} style={{ display: "inline" }} /> Remover
                  </button>
                </div>
                <strong>{formatBRL(line.unitPriceInCents * line.quantity)}</strong>
              </article>
            ))}
          </div>
          <aside className="summary-card">
            <h2>Resumo</h2>
            <div className="summary-line">
              <span>Subtotal</span>
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
            <Link className="primary-button full-button" href="/checkout">
              Continuar para o checkout
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
}
