"use client";

import { useCallback, useEffect, useState } from "react";
import { BlingOperational } from "./bling-operational";

export function BlingManagementSummary() {
  const [summary, setSummary] = useState<{ synced: number; pending: number; failed: number } | null>(null);
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  const load = useCallback(async () => {
    setSummary(null); setError("");
    try {
      const response = await fetch("/api/integrations/bling/summary", { cache: "no-store" });
      const result = await response.json() as { summary?: { synced: number; pending: number; failed: number } };
      if (!response.ok || !result.summary) throw new Error("Resumo da integração indisponível.");
      setSummary(result.summary);
    } catch { setError("Resumo da integração indisponível."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="panel-card">
    <h2>Integração de pedidos</h2>
    {error ? <p role="alert">{error} <button type="button" onClick={() => void load()}>Tentar novamente</button></p>
      : summary ? <p>{summary.synced} no Bling · {summary.pending} aguardando · {summary.failed} com pendência</p>
        : <p role="status">Carregando integração…</p>}
    <button className="secondary-button" type="button" aria-expanded={details} onClick={() => setDetails(!details)}>
      {details ? "Fechar pedidos integrados" : "Ver pedidos integrados"}
    </button>
    {details ? <BlingOperational readOnly /> : null}
  </section>;
}
