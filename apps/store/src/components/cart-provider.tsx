"use client";

import type { CartLine, Product } from "@curtiz/domain";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

type CartContextValue = {
  lines: CartLine[];
  hydrated: boolean;
  syncMessage: string;
  add: (
    product: Product,
    color: string,
    size: string,
    options?: {
      variantId?: string;
      unitPriceInCents?: number;
      stock?: number;
      image?: string;
    }
  ) => void;
  remove: (variantId: string) => void;
  changeQuantity: (variantId: string, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const hydratedLinesRef = useRef<CartLine[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("curtiz-demo-cart");
      const restored = stored ? (JSON.parse(stored) as CartLine[]) : [];
      hydratedLinesRef.current = restored;
      setLines(restored);
    } catch {
      localStorage.removeItem("curtiz-demo-cart");
      hydratedLinesRef.current = [];
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("curtiz-demo-cart", JSON.stringify(lines));
  }, [hydrated, lines]);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    const syncCartId = localStorage.getItem("curtiz-cart-sync-id") ?? undefined;
    void fetch("/api/cart/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: hydratedLinesRef.current, syncCartId }),
      signal: controller.signal
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          items?: CartLine[];
          cartId?: string;
          adjustmentMessage?: string;
          message?: string;
        };
        if (response.status === 401) return;
        if (!response.ok || !result.items || !result.cartId) {
          setSyncMessage(
            result.message ??
              "O carrinho continua salvo neste dispositivo, mas não foi sincronizado com a conta."
          );
          return;
        }
        setLines(result.items);
        localStorage.setItem("curtiz-cart-sync-id", result.cartId);
        setSyncMessage(result.adjustmentMessage ?? "");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSyncMessage(
            "O carrinho continua salvo neste dispositivo, mas não foi sincronizado com a conta."
          );
        }
      });
    return () => controller.abort();
  }, [hydrated]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      hydrated,
      syncMessage,
      add(product, color, size, options) {
        const variantId = options?.variantId ?? `${product.id}:${color}:${size}`;
        const stock = Math.max(0, options?.stock ?? product.stock);
        setLines((current) => {
          const found = current.find((line) => line.variantId === variantId);
          if (found) {
            return current.map((line) =>
              line.variantId === variantId
                ? { ...line, quantity: Math.min(line.quantity + 1, stock) }
                : line
            );
          }
          return [
            ...current,
            {
              productId: product.id,
              slug: product.slug,
              variantId,
              name: product.name,
              image: options?.image ?? product.image,
              color,
              size,
              quantity: 1,
              maxQuantity: Math.min(stock, 10),
              unitPriceInCents: options?.unitPriceInCents ?? product.priceInCents
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
            line.variantId === variantId
              ? {
                  ...line,
                  quantity: Math.min(line.maxQuantity ?? 10, Math.max(1, quantity))
                }
              : line
          )
        );
      },
      clear() {
        setLines([]);
      }
    }),
    [hydrated, lines, syncMessage]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart deve estar dentro de CartProvider.");
  return context;
}
