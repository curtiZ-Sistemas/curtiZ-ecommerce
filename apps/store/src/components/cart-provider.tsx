"use client";

import type { CartLine, Product } from "@curtiz/domain";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { fetchPublicAuthSession } from "@/lib/auth-session-client";
import { trackIntelligence } from "../lib/intelligence-client";
import {
  PERSISTENT_CART_KEY,
  PERSISTENT_CART_SYNC_KEY,
  SESSION_CART_KEY,
  SESSION_CART_SYNC_KEY,
  readClientPersistence,
  setClientAuthPersistence,
  type ClientPersistence
} from "@/lib/session-persistence-client";

type CartContextValue = {
  lines: CartLine[];
  hydrated: boolean;
  syncMessage: string;
  retrySync: () => void;
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
  reconcile: (lines: CartLine[]) => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const legacyCartStorageKey = "curtiz-demo-cart";
type AuthenticationState = "authenticated" | "unknown" | "visitor";

const isCartLine = (value: unknown): value is CartLine => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.productId === "string" &&
    typeof line.variantId === "string" &&
    typeof line.name === "string" &&
    typeof line.image === "string" &&
    typeof line.color === "string" &&
    typeof line.size === "string" &&
    Number.isInteger(line.quantity) &&
    Number(line.quantity) > 0 &&
    Number(line.quantity) <= 99 &&
    Number.isInteger(line.unitPriceInCents) &&
    Number(line.unitPriceInCents) >= 0
  );
};

const cartSignature = (lines: CartLine[]) =>
  JSON.stringify(
    lines.map((line) => [
      line.productId,
      line.variantId,
      line.quantity,
      line.unitPriceInCents,
      line.maxQuantity
    ])
  );

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncRetry, setSyncRetry] = useState(0);
  const [authentication, setAuthentication] = useState<AuthenticationState>("unknown");
  const [persistence, setPersistence] = useState<ClientPersistence>(() =>
    typeof window === "undefined" ? "persistent" : readClientPersistence()
  );
  const lastSyncedSignatureRef = useRef("");
  const latestRequestedSignatureRef = useRef("");
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    try {
      const activePersistence = readClientPersistence();
      setPersistence(activePersistence);
      const storage = activePersistence === "session" ? sessionStorage : localStorage;
      const storageKey = activePersistence === "session" ? SESSION_CART_KEY : PERSISTENT_CART_KEY;
      const stored = storage.getItem(storageKey) ?? localStorage.getItem(legacyCartStorageKey);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      const restored = Array.isArray(parsed) ? parsed.filter(isCartLine) : [];
      setLines(restored);
      if (localStorage.getItem(legacyCartStorageKey)) {
        storage.setItem(storageKey, JSON.stringify(restored));
        localStorage.removeItem(legacyCartStorageKey);
      }
    } catch {
      localStorage.removeItem(PERSISTENT_CART_KEY);
      sessionStorage.removeItem(SESSION_CART_KEY);
      localStorage.removeItem(legacyCartStorageKey);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    const updatePersistence = () => setPersistence(readClientPersistence());
    const clearSessionState = () => {
      setLines([]);
      setAuthentication("visitor");
      setPersistence(readClientPersistence());
      lastSyncedSignatureRef.current = "[]";
      latestRequestedSignatureRef.current = "session-cleared";
      setSyncMessage("");
    };
    window.addEventListener("curtiz-auth-persistence-changed", updatePersistence);
    window.addEventListener("curtiz-session-state-cleared", clearSessionState);
    return () => {
      window.removeEventListener("curtiz-auth-persistence-changed", updatePersistence);
      window.removeEventListener("curtiz-session-state-cleared", clearSessionState);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const storage = persistence === "session" ? sessionStorage : localStorage;
    const storageKey = persistence === "session" ? SESSION_CART_KEY : PERSISTENT_CART_KEY;
    storage.setItem(storageKey, JSON.stringify(lines));
  }, [hydrated, lines, persistence]);

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    void fetchPublicAuthSession().then((session) => {
      if (!active) return;
      setAuthentication(session.authenticated ? "authenticated" : "visitor");
      if (session.authenticated) setClientAuthPersistence(session.persistent === true);
    });
    return () => {
      active = false;
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || authentication !== "authenticated") return;
    const signature = cartSignature(lines);
    if (lastSyncedSignatureRef.current === signature) return;
    latestRequestedSignatureRef.current = signature;
    const timer = window.setTimeout(() => {
      const snapshot = lines;
      syncQueueRef.current = syncQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const syncStorage = persistence === "session" ? sessionStorage : localStorage;
          const syncKey =
            persistence === "session" ? SESSION_CART_SYNC_KEY : PERSISTENT_CART_SYNC_KEY;
          const syncCartId = syncStorage.getItem(syncKey) ?? undefined;
          try {
            const response = await fetch("/api/cart/sync", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ lines: snapshot, syncCartId })
            });
            if (response.status === 401) {
              setAuthentication("visitor");
              return;
            }
            const result = (await response.json()) as {
              items?: CartLine[];
              cartId?: string;
              adjustmentMessage?: string;
              message?: string;
            };
            if (!response.ok || !result.items || !result.cartId) {
              if (latestRequestedSignatureRef.current === signature) {
                setSyncMessage(
                  result.message ??
                    "O carrinho continua salvo neste dispositivo, mas não foi sincronizado."
                );
              }
              return;
            }
            const localCategories = new Map(
              snapshot.flatMap((line) =>
                line.category ? ([[line.productId, line.category]] as const) : []
              )
            );
            const safeItems = result.items.filter(isCartLine).map((line) => {
              const category = localCategories.get(line.productId);
              return category ? { ...line, category } : line;
            });
            const remoteSignature = cartSignature(safeItems);
            syncStorage.setItem(syncKey, result.cartId);
            if (latestRequestedSignatureRef.current !== signature) return;
            lastSyncedSignatureRef.current = remoteSignature;
            if (remoteSignature !== signature) setLines(safeItems);
            setSyncMessage(result.adjustmentMessage ?? "");
          } catch {
            if (latestRequestedSignatureRef.current !== signature) return;
            setSyncMessage(
              "O carrinho continua salvo neste dispositivo, mas não foi sincronizado."
            );
          }
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [authentication, hydrated, lines, persistence, syncRetry]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      hydrated,
      syncMessage,
      retrySync() {
        lastSyncedSignatureRef.current = "";
        setSyncMessage("");
        setSyncRetry((current) => current + 1);
      },
      add(product, color, size, options) {
        const variantId = options?.variantId ?? `${product.id}:${color}:${size}`;
        const stock = Math.max(0, options?.stock ?? product.stock);
        if (stock < 1) return;
        trackIntelligence({ type: "cart_add", productId: product.id, variantId });
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
              category: product.category,
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
        const line = lines.find((item) => item.variantId === variantId);
        if (line) trackIntelligence({ type: "cart_remove", productId: line.productId, variantId });
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
      },
      reconcile(nextLines) {
        const safeLines = nextLines.filter(isCartLine);
        lastSyncedSignatureRef.current = cartSignature(safeLines);
        setLines(safeLines);
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
