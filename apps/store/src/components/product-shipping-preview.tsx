"use client";

import { formatBRL } from "@curtiz/domain";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatPostalCode } from "../lib/personal-data";
import { readShippingPostalCode, rememberShippingPostalCode } from "../lib/shipping-postal-code";

type Quote = { serviceId: string; service: string; carrier: string; amountInCents: number; estimatedDays: number };
function isQuote(value: unknown): value is Quote {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return [row.serviceId, row.service, row.carrier].every((item) => typeof item === "string")
    && Number.isInteger(row.amountInCents) && Number(row.amountInCents) >= 0
    && Number.isInteger(row.estimatedDays) && Number(row.estimatedDays) > 0;
}

export function ProductShippingPreview({ productId, variantId }: { productId: string; variantId?: string }) {
  const [postalCode, setPostalCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [result, setResult] = useState<{ key: string; quotes: Quote[]; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const currentKey = `${productId}:${variantId ?? ""}:${quantity}:${postalCode}`;
  const latestKey = useRef(currentKey);
  latestKey.current = currentKey;
  const visible = result?.key === currentKey ? result : null;

  useEffect(() => { setPostalCode(formatPostalCode(readShippingPostalCode())); }, []);
  useEffect(() => {
    controller.current?.abort();
    setLoading(false);
    return () => { controller.current?.abort(); };
  }, [currentKey]);

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    controller.current?.abort();
    const key = currentKey;
    if (!/^\d{5}-?\d{3}$/u.test(postalCode)) {
      setResult({ key, quotes: [], message: "Informe um CEP válido com oito dígitos." });
      return;
    }
    if (!variantId) {
      setResult({ key, quotes: [], message: "Escolha a cor e o tamanho para calcular." });
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      setResult({ key, quotes: [], message: "Informe uma quantidade de 1 a 10 para a simulação." });
      return;
    }
    rememberShippingPostalCode(postalCode);
    const active = new AbortController();
    controller.current = active;
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/shipping/preview", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ postalCode, productId, variantId, quantity }), signal: active.signal, cache: "no-store" });
      const data: unknown = await response.json();
      if (active.signal.aborted || latestKey.current !== key) return;
      if (typeof data !== "object" || data === null) throw new Error("invalid response");
      const payload = data as Record<string, unknown>;
      if (!response.ok || payload.ok !== true) {
        setResult({ key, quotes: [], message: typeof payload.message === "string" ? payload.message : "Não foi possível calcular. Tente novamente." });
        return;
      }
      if (!Array.isArray(payload.quotes) || !payload.quotes.every(isQuote)) throw new Error("invalid quotes");
      setResult({ key, quotes: payload.quotes, message: payload.quotes.length ? "" : "Nenhum serviço atende este CEP e este produto." });
    } catch {
      if (!active.signal.aborted && latestKey.current === key) setResult({ key, quotes: [], message: "Não foi possível calcular o frete. Tente novamente." });
    } finally {
      if (controller.current === active) setLoading(false);
    }
  }

  return <section className="product-shipping-preview" aria-labelledby="product-shipping-title">
    <h2 id="product-shipping-title">Calcule o frete e o prazo de entrega</h2>
    <form onSubmit={(event) => { void calculate(event); }} noValidate>
      <div className="field"><label htmlFor="product-shipping-postal">CEP</label>
        <input id="product-shipping-postal" inputMode="numeric" autoComplete="postal-code" maxLength={9}
          placeholder="00000-000" value={postalCode} onChange={(event) => setPostalCode(formatPostalCode(event.target.value))} /></div>
      <div className="field"><label htmlFor="product-shipping-quantity">Qtd. na simulação</label>
        <input id="product-shipping-quantity" type="number" min={1} max={10} value={quantity}
          onChange={(event) => setQuantity(event.target.valueAsNumber || 0)} /></div>
      <button className="secondary-button" type="submit" disabled={loading}>{loading ? "Calculando…" : "Calcular"}</button>
    </form>
    <div role="status" aria-live="polite" aria-busy={loading}>
      {loading ? <p>Consultando os serviços de entrega…</p> : null}
      {visible?.message ? <p>{visible.message}</p> : null}
      {visible?.quotes.length ? <ul>{visible.quotes.map((quote) => <li key={quote.serviceId}>
        <span>{quote.carrier} — {quote.service}</span><strong>{formatBRL(quote.amountInCents)}</strong>
        <span>{quote.estimatedDays} {quote.estimatedDays === 1 ? "dia útil" : "dias úteis"}</span>
      </li>)}</ul> : null}
    </div>
    <p className="product-shipping-note">Estimativa para a quantidade informada. O frete será recalculado no checkout.</p>
  </section>;
}
