"use client";

import { ChevronDown, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BlingOperational } from "./bling-operational";
import { SectionHeader, StatusLabel } from "@/components/panel-ui";

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
  return <section className="bling-management-summary" aria-labelledby="bling-management-title">
    <SectionHeader
      id="bling-management-title"
      title="Integração de pedidos"
      description="Situação dos pedidos enviados ao Bling."
      actions={<button className="secondary-button" type="button" aria-expanded={details} onClick={() => setDetails(!details)}>
        <ChevronDown aria-hidden="true" className={details ? "bling-management-chevron is-open" : "bling-management-chevron"} />
        {details ? "Fechar pedidos integrados" : "Ver pedidos integrados"}
      </button>}
    />
    {error ? <p className="bling-management-status" role="alert">
      <StatusLabel tone="danger">Indisponível</StatusLabel>
      <span>{error}</span>
      <button className="ghost-button" type="button" onClick={() => void load()}><RotateCcw aria-hidden="true" /> Tentar novamente</button>
    </p>
      : summary ? <dl className="bling-management-counts">
        <div><dt>No Bling</dt><dd className="ui-num">{summary.synced.toLocaleString("pt-BR")}</dd></div>
        <div><dt>Aguardando</dt><dd className="ui-num">{summary.pending.toLocaleString("pt-BR")}</dd></div>
        <div>
          <dt>Com pendência</dt>
          <dd>{summary.failed > 0
            ? <StatusLabel tone="warning"><span className="ui-num">{summary.failed.toLocaleString("pt-BR")}</span> com pendência</StatusLabel>
            : <span className="ui-num">0</span>}</dd>
        </div>
      </dl>
        : <p className="bling-management-status" role="status"><span className="ui-skeleton bling-management-skeleton" aria-hidden="true" /><span className="sr-only">Carregando integração…</span></p>}
    {details ? <div className="bling-management-details"><BlingOperational readOnly /></div> : null}
  </section>;
}
