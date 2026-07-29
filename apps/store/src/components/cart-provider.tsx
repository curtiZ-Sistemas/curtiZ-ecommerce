"use client";

import type { CartLine, Product } from "@curtiz/domain";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

type CartContextValue = {
  lines: CartLine[];
  add: (product: Product, color: string, size: string) => void;
  remove: (variantId: string) => void;
  changeQuantity: (variantId: string, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("curtiz-demo-cart");
      if (stored) setLines(JSON.parse(stored) as CartLine[]);
    } catch {
      localStorage.removeItem("curtiz-demo-cart");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("curtiz-demo-cart", JSON.stringify(lines));
  }, [lines]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      add(product, color, size) {
        const variantId = `${product.id}:${color}:${size}`;
        setLines((current) => {
          const found = current.find((line) => line.variantId === variantId);
          if (found) {
            return current.map((line) =>
              line.variantId === variantId
                ? { ...line, quantity: Math.min(line.quantity + 1, product.stock) }
                : line
            );
          }
          return [
            ...current,
            {
              productId: product.id,
              variantId,
              name: product.name,
              image: product.image,
              color,
              size,
              quantity: 1,
              unitPriceInCents: product.priceInCents
            }
          ];
        });
      },
      remove(variantId) {
        setLines((current) => current.filter((line) => line.variantId !== variantId));
      },
      changeQuantity(variantId, quantity) {
        setLines((current) =>
          current.map((line) =>
            line.variantId === variantId ? { ...line, quantity: Math.max(1, quantity) } : line
          )
        );
      },
      clear() {
        setLines([]);
      }
    }),
    [lines]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart deve estar dentro de CartProvider.");
  return context;
}
