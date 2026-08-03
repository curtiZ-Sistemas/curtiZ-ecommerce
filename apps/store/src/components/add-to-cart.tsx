"use client";

import type { Product } from "@curtiz/domain";
import { Check, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCart } from "./cart-provider";

export function AddToCart({ product }: { product: Product }) {
  const [color, setColor] = useState(product.colors[0] ?? "");
  const [size, setSize] = useState(product.sizes[0] ?? "");
  const [added, setAdded] = useState(false);
  const { add } = useCart();
  const router = useRouter();

  const handleAdd = () => {
    if (added) return;
    add(product, color, size);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
  };

  const handleBuyNow = () => {
    if (added) return;
    add(product, color, size);
    setAdded(true);
    const variant = `${product.id}:${color}:${size}`;
    router.push(`/checkout?comprarAgora=${encodeURIComponent(variant)}`);
  };

  return (
    <div className="product-options">
      <fieldset>
        <legend>Cor: {color}</legend>
        <div className="option-row">
          {product.colors.map((item) => (
            <button
              className={item === color ? "option active" : "option"}
              type="button"
              key={item}
              onClick={() => setColor(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Tamanho</legend>
        <div className="option-row">
          {product.sizes.map((item) => (
            <button
              className={item === size ? "option active" : "option"}
              type="button"
              key={item}
              onClick={() => setSize(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="sr-only" role="status" aria-live="polite">
        {added ? `${product.name} adicionado ao carrinho.` : ""}
      </p>
      <button className="primary-button full-button" type="button" onClick={handleAdd} disabled={added}>
        {added ? <Check /> : <ShoppingBag />}
        {added ? "Adicionado ao carrinho" : "Adicionar ao carrinho"}
      </button>
      <button
        className="secondary-button full-button buy-now-button"
        type="button"
        onClick={handleBuyNow}
        disabled={added}
      >
        Comprar agora
      </button>
    </div>
  );
}
