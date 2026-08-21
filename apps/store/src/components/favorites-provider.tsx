"use client";

import type { Product } from "@curtiz/domain";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { demoProducts } from "@/lib/catalog";
import { trackIntelligence } from "../lib/intelligence-client";

type FavoritesContextValue = {
  ids: string[];
  products: Product[];
  hydrated: boolean;
  has: (productId: string) => boolean;
  toggle: (product: Product) => void;
  remove: (productId: string) => void;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);
const storageKey = "curtiz-favorites";
const legacyStorageKey = "curtiz-demo-favorites";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const syncFavorite = (action: "favorite_save" | "favorite_remove", productId: string) => {
  if (!uuidPattern.test(productId)) return;
  void fetch("/api/customer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, productId })
  }).catch(() => {
    // O favorito permanece neste dispositivo quando a conta está offline ou deslogada.
  });
};

const isStoredProduct = (value: unknown): value is Product => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const product = value as Partial<Product>;
  return (
    typeof product.id === "string" &&
    typeof product.slug === "string" &&
    typeof product.name === "string" &&
    typeof product.priceInCents === "number" &&
    typeof product.image === "string" &&
    Array.isArray(product.colors) &&
    Array.isArray(product.sizes)
  );
};

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey) ?? "[]";
      const stored: unknown = JSON.parse(raw);
      if (Array.isArray(stored)) {
        const restored = stored
          .map((item) =>
            isStoredProduct(item)
              ? item
              : typeof item === "string"
                ? demoProducts.find((product) => product.id === item)
                : undefined
          )
          .filter((product): product is Product => Boolean(product))
          .slice(0, 50);
        setProducts(restored);
      }
    } catch {
      localStorage.removeItem(storageKey);
      localStorage.removeItem(legacyStorageKey);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(storageKey, JSON.stringify(products));
    localStorage.removeItem(legacyStorageKey);
  }, [hydrated, products]);

  const value = useMemo<FavoritesContextValue>(
    () => ({
      ids: products.map((product) => product.id),
      products,
      hydrated,
      has(productId) {
        return products.some((product) => product.id === productId);
      },
      toggle(product) {
        setProducts((current) => {
          const removing = current.some((item) => item.id === product.id);
          syncFavorite(removing ? "favorite_remove" : "favorite_save", product.id);
          trackIntelligence({ type: removing ? "favorite_remove" : "favorite_add", productId: product.id });
          return removing
            ? current.filter((item) => item.id !== product.id)
            : [...current, product].slice(-50);
        });
      },
      remove(productId) {
        syncFavorite("favorite_remove", productId);
        trackIntelligence({ type: "favorite_remove", productId });
        setProducts((current) => current.filter((item) => item.id !== productId));
      }
    }),
    [hydrated, products]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const context = useContext(FavoritesContext);
  if (!context) throw new Error("useFavorites deve estar dentro de FavoritesProvider.");
  return context;
}
