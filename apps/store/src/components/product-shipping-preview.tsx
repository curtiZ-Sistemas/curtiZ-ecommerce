"use client";

import { formatBRL } from "@curtiz/domain";
import { Truck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatPostalCode } from "../lib/personal-data";
import { readShippingPostalCode, rememberShippingPostalCode } from "../lib/shipping-postal-code";

const POSTAL_CODE = /^\d{5}-?\d{3}$/u;
type Quote = { serviceId: string; service: string; carrier: string; amountInCents: number; estimatedDays: number };
function isQuote(value: unknown): value is Quote {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return [row.serviceId, row.service, row.carrier].every((item) => typeof item === "string")
    && Number.isInteger(row.amountInCents) && Number(row.amountInCents) >= 0
    && Number.isInteger(row.estimatedDays) && Number(row.estimatedDays) > 0;
}

export function ProductShippingPreview({ productId, variantId, quantity }: { productId: string; variantId?: string; quantity: number }) {
  const [postalCode, setPostalCode] = useState("");
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
      setResult({ key, quotes: [], message: "Escolha uma quantidade de 1 a 10 para calcular." });
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

  const failed = Boolean(visible?.message) && !visible?.quotes.length;
  return <section className="product-shipping-preview" aria-label="Calcule o frete e o prazo de entrega">
    <form onSubmit={(event) => { void calculate(event); }} noValidate>
      <label className="sr-only" htmlFor="product-shipping-postal">CEP</label>
      <div className="shipping-input"><Truck aria-hidden="true" />
        <input id="product-shipping-postal" inputMode="numeric" autoComplete="postal-code" maxLength={9}
          placeholder="Digite seu CEP" value={postalCode} aria-invalid={failed && !POSTAL_CODE.test(postalCode) ? true : undefined}
          onChange={(event) => setPostalCode(formatPostalCode(event.target.value))} /></div>
      <button type="submit" disabled={loading}>{loading ? "Calculando…" : "Calcular"}</button>
    </form>
    <div className="shipping-result" role="status" aria-live="polite" aria-busy={loading}>
      {loading ? <div className="shipping-skeleton" aria-hidden="true"><span /><span /></div> : null}
      {loading ? <p className="sr-only">Consultando os serviços de entrega…</p> : null}
      {visible?.message ? <p className="shipping-message" data-tone={failed && !visible?.message.startsWith("Nenhum") ? "error" : "info"}>{visible.message}</p> : null}
      {visible?.quotes.length ? <ul>{visible.quotes.map((quote) => <li key={quote.serviceId}>
        <div><strong>{quote.service}</strong>
          <span>{quote.carrier} · {quote.estimatedDays} {quote.estimatedDays === 1 ? "dia útil" : "dias úteis"}</span></div>
        <b>{formatBRL(quote.amountInCents)}</b>
      </li>)}</ul> : null}
    </div>
  </section>;
}
