"use client";

import { cashChangeInCents, formatBRL, parseBRLToCents } from "@curtiz/domain";
import { useId } from "react";

export function kitCashTenderInCents(value: string): number | null {
  try {
    const cents = parseBRLToCents(value);
    return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
  } catch {
    return null;
  }
}

export function RepresentativeKitCashChange({ totalInCents, tendered, onTenderedChange }: {
  totalInCents: number;
  tendered: string;
  onTenderedChange: (value: string) => void;
}) {
  const inputId = useId();
  const changeId = useId();
  const cents = kitCashTenderInCents(tendered);
  const change = cents === null ? null : cashChangeInCents(totalInCents, cents);
  const message = !tendered.trim() ? "Informe o valor que você vai entregar."
    : cents === null ? "Informe um valor válido em reais."
    : change === null ? `O valor precisa cobrir os ${formatBRL(totalInCents)} do pedido.`
    : change === 0 ? "Valor exato. Você não precisa de troco."
    : `Troco no recebimento: ${formatBRL(change)}.`;

  return (
    <div>
      <label htmlFor={inputId}>Valor que você vai entregar</label>
      <input id={inputId} value={tendered} onChange={event => onTenderedChange(event.target.value)}
        inputMode="decimal" maxLength={20} placeholder="0,00" aria-describedby={changeId} />
      <output id={changeId} htmlFor={inputId} aria-live="polite">{message}</output>
    </div>
  );
}
