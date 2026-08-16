"use client";

import type { CartLine, Product } from "@curtiz/domain";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

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
const cartStorageKey = "curtiz-cart";
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
  const lastSyncedSignatureRef = useRef("");
  const latestRequestedSignatureRef = useRef("");
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    try {
      const stored =
        localStorage.getItem(cartStorageKey) ?? localStorage.getItem(legacyCartStorageKey);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      const restored = Array.isArray(parsed) ? parsed.filter(isCartLine) : [];
      setLines(restored);
      if (localStorage.getItem(legacyCartStorageKey)) {
        localStorage.setItem(cartStorageKey, JSON.stringify(restored));
        localStorage.removeItem(legacyCartStorageKey);
      }
    } catch {
      localStorage.removeItem(cartStorageKey);
      localStorage.removeItem(legacyCartStorageKey);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(cartStorageKey, JSON.stringify(lines));
  }, [hydrated, lines]);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    void fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return { authenticated: false };
        return (await response.json()) as { authenticated?: boolean };
      })
      .then((session) => setAuthentication(session.authenticated ? "authenticated" : "visitor"))
      .catch(() => {
        if (!controller.signal.aborted) setAuthentication("visitor");
      });
    return () => controller.abort();
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
          const syncCartId = localStorage.getItem("curtiz-cart-sync-id") ?? undefined;
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
            const safeItems = result.items.filter(isCartLine);
            const remoteSignature = cartSignature(safeItems);
            localStorage.setItem("curtiz-cart-sync-id", result.cartId);
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
  }, [authentication, hydrated, lines, syncRetry]);

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
