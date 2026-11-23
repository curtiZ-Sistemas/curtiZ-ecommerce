"use client";

import { useEffect, useState } from "react";
import { isUnknownRecord, readNumber, readString } from "../lib/unknown-data";

export type KitQuote = { id: string; amount: number; shipping: number; days: number; methods: string[] };
export type KitQuoteState =
  | { status: "idle" | "loading" | "error" }
  | { status: "ready"; quote: KitQuote }
  | { status: "refused"; reason: string };

export const kitRefusalMessages: Record<string, string> = {
  not_enabled: "Sua conta ainda não está habilitada para comprar kits.",
  address: "Não foi possível entregar neste endereço. Escolha outro endereço ou ficha.",
  collection: "Pagamento na entrega indisponível para este endereço.",
  unavailable: "A compra de kits está indisponível no momento."
};

export type KitQuoteInput = { kitId: string; template: string; quantity: number; addressId: string; mode: "prepay" | "collection" };

// One quote per address, quantity and payment timing. A failed request can be retried with `retry`.
export function useKitQuote(input: KitQuoteInput | null, retry = 0): KitQuoteState {
  const payload = input ? JSON.stringify({ kitId: input.kitId, template: input.template, quantity: input.quantity,
    addressId: input.addressId, paymentTiming: input.mode }) : "";
  const mode = input?.mode;
  const key = `${payload}:${retry}`;
  const [result, setResult] = useState<{ key: string; state: KitQuoteState } | null>(null);
  useEffect(() => {
    if (!payload) return;
    const request = new AbortController();
    const finish = (state: KitQuoteState) => { if (!request.signal.aborted) setResult({ key, state }); };
    void fetch("/api/representatives/kits/collection", {
      method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: request.signal
    }).then(async response => {
      const data: unknown = await response.json();
      if (!response.ok || !isUnknownRecord(data)) throw new Error("invalid_delivery");
      if (data.quote === null) {
        finish({ status: "refused", reason: readString(data, "reason", "address") });
        return;
      }
      if (!isUnknownRecord(data.quote)) throw new Error("invalid_delivery");
      const id = readString(data.quote, "id");
      const amount = readNumber(data.quote, "amountInCents");
      const shipping = readNumber(data.quote, "shippingInCents", -1);
      const days = readNumber(data.quote, "estimatedDays", -1);
      const methods = Array.isArray(data.quote.collectionMethods)
        ? (data.quote.collectionMethods as unknown[]).filter((item): item is string => typeof item === "string") : [];
      if (!id || !Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(shipping) || shipping < 0) {
        throw new Error("invalid_delivery");
      }
      finish(mode === "collection" && methods.length === 0
        ? { status: "refused", reason: "collection" }
        : { status: "ready", quote: { id, amount, shipping, days, methods } });
    }).catch(() => finish({ status: "error" }));
    return () => request.abort();
  }, [key, payload, mode]);
  if (!payload) return { status: "idle" };
  return result?.key === key ? result.state : { status: "loading" };
}
