"use client";

import { ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ManagementEmptyState,
  ManagementPageHeader,
  ManagementSectionHeader
} from "@/components/management-ui";
import { LoadingBlock, StatusLabel } from "@/components/panel-ui";
import { managementPeriodFor } from "@/lib/management-period";

type AlertKey =
  | "reconciliation_divergences"
  | "failed_commission_payments"
  | "critical_stock"
  | "refunds_in_period";

type AlertDefinition = {
  key: AlertKey;
  title: string;
  description: string;
  href: string;
  action: string;
  /** Falha de processamento é crítica; as demais pedem acompanhamento. */
  tone: "warning" | "danger";
};

const definitions: AlertDefinition[] = [
  {
    key: "reconciliation_divergences",
    title: "Divergências de conciliação",
    description: "Registros financeiros ainda não resolvidos.",
    href: "/gerencia/financeiro",
    action: "Abrir financeiro",
    tone: "warning"
  },
  {
    key: "failed_commission_payments",
    title: "Pagamentos de comissão com falha",
    description: "Falhas que exigem conferência antes de uma nova tentativa.",
    href: "/gerencia/pagamentos",
    action: "Revisar pagamentos",
    tone: "danger"
  },
  {
    key: "critical_stock",
    title: "Estoque crítico",
    description: "Variações no estoque mínimo ou abaixo dele.",
    href: "/gerencia/relatorios",
    action: "Abrir relatórios",
    tone: "warning"
  },
  {
    key: "refunds_in_period",
    title: "Pedidos reembolsados",
    description: "Reembolsos registrados nos últimos 30 dias.",
    href: "/gerencia/pedidos-vendas",
    action: "Ver pedidos",
    tone: "warning"
  }
];

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function ManagerAlerts() {
  const [alerts, setAlerts] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const dates = managementPeriodFor("30days");
      const params = new URLSearchParams({ ...dates, includeOptions: "0" });
      const response = await fetch(`/api/manager/dashboard?${params}`, { cache: "no-store" });
      const payload = asRecord(await response.json());
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : "Falha ao carregar alertas.");
      setAlerts(asRecord(asRecord(payload.metrics).alerts));
    } catch (loadError) {
      setAlerts({});
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os alertas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const total = definitions.reduce((sum, item) => sum + numeric(alerts[item.key]), 0);
  const active = definitions.filter((item) => numeric(alerts[item.key]) > 0);
  const quiet = definitions.filter((item) => numeric(alerts[item.key]) === 0);

  return (
    <section className="management-page manager-alert-center" aria-busy={loading}>
      <ManagementPageHeader
        title="Alertas gerenciais"
        description="Ocorrências reais que precisam de acompanhamento nas áreas responsáveis."
        actions={<button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} aria-hidden="true" /> Atualizar</button>}
      />
      {error ? <ManagementEmptyState kind="error" title="Alertas indisponíveis" description={error} action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Tentar novamente</button>} /> : null}
      {!error && loading ? <div className="manager-alert-loading"><LoadingBlock label="Carregando alertas" rows={4} /></div> : null}
      {!error && !loading && total === 0 ? <ManagementEmptyState title="Nenhum alerta pendente" description="Não há divergências, falhas, estoque crítico ou reembolsos no recorte atual." /> : null}
      {!error && !loading && total > 0 ? <>
        <section className="panel-card manager-alert-group" aria-labelledby="manager-alerts-active">
          <ManagementSectionHeader id="manager-alerts-active" title="Requer acompanhamento" description="Cada item direciona para o fluxo operacional correspondente." />
          <ul className="manager-alert-list">
            {active.map((definition) => <AlertItem key={definition.key} definition={definition} value={numeric(alerts[definition.key])} />)}
          </ul>
        </section>
        {quiet.length ? <section className="panel-card manager-alert-group" aria-labelledby="manager-alerts-quiet">
          <ManagementSectionHeader id="manager-alerts-quiet" title="Sem ocorrências" description="Áreas sem registros no recorte atual." />
          <ul className="manager-alert-list">
            {quiet.map((definition) => <AlertItem key={definition.key} definition={definition} value={0} />)}
          </ul>
        </section> : null}
      </> : null}
    </section>
  );
}

function AlertItem({ definition, value }: { definition: AlertDefinition; value: number }) {
  return (
    <li className="manager-alert-row manager-alert-entry">
      <span>
        <strong>{definition.title}</strong>
        <small>{definition.description}</small>
      </span>
      {value > 0
        ? <StatusLabel tone={definition.tone}>{value.toLocaleString("pt-BR")} ocorrência(s)</StatusLabel>
        : <StatusLabel tone="neutral">Nenhuma ocorrência</StatusLabel>}
      <Link className="manager-alert-link" href={definition.href}>
        {definition.action} <ChevronRight aria-hidden="true" />
      </Link>
    </li>
  );
}
