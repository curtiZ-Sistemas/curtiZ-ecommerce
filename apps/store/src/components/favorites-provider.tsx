"use client";

import { storefrontItemKey, type Product } from "@curtiz/domain";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { demoProducts } from "@/lib/catalog";
import { trackIntelligence } from "../lib/intelligence-client";

type FavoritesContextValue = {
  ids: string[];
  products: Product[];
  hydrated: boolean;
  has: (product: string | Pick<Product, "id" | "storefrontKey" | "variantId">) => boolean;
  toggle: (product: Product) => void;
  remove: (productId: string, variantId?: string) => void;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);
const storageKey = "curtiz-favorites";
const legacyStorageKey = "curtiz-demo-favorites";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const syncFavorite = (
  action: "favorite_save" | "favorite_remove",
  productId: string,
  variantId?: string
) => {
  if (!uuidPattern.test(productId)) return;
  void fetch("/api/customer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, productId, variantId })
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
      has(product) {
        if (typeof product === "string") {
          return products.some((candidate) => candidate.id === product && !candidate.variantId);
        }
        const key = storefrontItemKey(product);
        return products.some((candidate) => storefrontItemKey(candidate) === key);
      },
      toggle(product) {
        setProducts((current) => {
          const key = storefrontItemKey(product);
          const removing = current.some((item) => storefrontItemKey(item) === key);
          syncFavorite(removing ? "favorite_remove" : "favorite_save", product.id, product.variantId);
          trackIntelligence({ type: removing ? "favorite_remove" : "favorite_add", productId: product.id, variantId: product.variantId });
          return removing
            ? current.filter((item) => storefrontItemKey(item) !== key)
            : [...current, product].slice(-50);
        });
      },
      remove(productId, variantId) {
        const key = `${productId}:${variantId ?? "product"}`;
        syncFavorite("favorite_remove", productId, variantId);
        trackIntelligence({ type: "favorite_remove", productId, variantId });
        setProducts((current) => current.filter((item) => storefrontItemKey(item) !== key));
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
