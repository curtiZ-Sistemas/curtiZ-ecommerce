"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MercadoPagoSavedCard } from "@curtiz/integrations";
import { isUnknownRecord } from "@/lib/unknown-data";

export function SavedCards() {
  const [enabled, setEnabled] = useState(false);
  const [cards, setCards] = useState<MercadoPagoSavedCard[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/customer/cards", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    const result: unknown = await response.json();
    if (!response.ok || !isUnknownRecord(result) || result.ok !== true) throw new Error("cards_unavailable");
    setEnabled(result.enabled === true);
    setCards(Array.isArray(result.cards) ? result.cards.flatMap(card => {
      if (!isUnknownRecord(card) || typeof card.id !== "string" || typeof card.brand !== "string" ||
        typeof card.lastFour !== "string" || !/^\d{4}$/u.test(card.lastFour) ||
        typeof card.expirationMonth !== "number" || typeof card.expirationYear !== "number") return [];
      return [{ id: card.id, brand: card.brand, lastFour: card.lastFour,
        expirationMonth: card.expirationMonth, expirationYear: card.expirationYear }];
    }) : []);
  }, []);
  useEffect(() => { void load().catch(() => setMessage("Não foi possível consultar seus cartões.")); }, [load]);
  if (!enabled) return null;
  return <section aria-labelledby="account-saved-cards-title">
    <h2 id="account-saved-cards-title">Cartões salvos</h2>
    {cards.length ? <ul className="saved-card-list">{cards.map(card => <li key={card.id}>
      <div><strong>{card.brand.toUpperCase()} •••• {card.lastFour}</strong><br />
        <small>Validade {String(card.expirationMonth).padStart(2, "0")}/{card.expirationYear}</small></div>
      <button type="button" className="secondary-button compact-button" disabled={pending}
        aria-label={`Excluir ${card.brand} terminado em ${card.lastFour}`} onClick={() => {
          if (busy.current || !window.confirm("Excluir este cartão salvo?")) return;
          busy.current = true; setPending(true); setMessage("");
          void fetch("/api/customer/cards", { method: "DELETE", headers: { "content-type": "application/json" },
            body: JSON.stringify({ cardId: card.id }) }).then(async response => {
            if (!response.ok) throw new Error("card_delete_failed");
            await load(); setMessage("Cartão excluído.");
          }).catch(() => setMessage("Não foi possível confirmar a exclusão. Atualize a lista e tente novamente."))
            .finally(() => { busy.current = false; setPending(false); });
        }}>Excluir</button>
    </li>)}</ul> : <p>Você ainda não tem cartões salvos.</p>}
    {message ? <p role="status">{message}</p> : null}
    <button type="button" className="customer-link-button" disabled={pending} onClick={() => void load().catch(() => setMessage("Não foi possível consultar seus cartões."))}>Atualizar cartões</button>
  </section>;
}
