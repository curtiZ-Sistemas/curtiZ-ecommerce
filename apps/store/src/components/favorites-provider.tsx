"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type FavoritesContextValue = {
  ids: string[];
  hydrated: boolean;
  has: (productId: string) => boolean;
  toggle: (productId: string) => void;
  remove: (productId: string) => void;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);
const storageKey = "curtiz-demo-favorites";

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(stored)) {
        setIds(stored.filter((item): item is string => typeof item === "string"));
      }
    } catch {
      localStorage.removeItem(storageKey);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(storageKey, JSON.stringify(ids));
  }, [hydrated, ids]);

  const value = useMemo<FavoritesContextValue>(
    () => ({
      ids,
      hydrated,
      has(productId) {
        return ids.includes(productId);
      },
      toggle(productId) {
        setIds((current) =>
          current.includes(productId)
            ? current.filter((item) => item !== productId)
            : [...current, productId]
        );
      },
      remove(productId) {
        setIds((current) => current.filter((item) => item !== productId));
      }
    }),
    [hydrated, ids]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const context = useContext(FavoritesContext);
  if (!context) throw new Error("useFavorites deve estar dentro de FavoritesProvider.");
  return context;
}
