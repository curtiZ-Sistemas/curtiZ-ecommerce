"use client";

import {
  BadgeAlert,
  Boxes,
  CircleDollarSign,
  RefreshCw,
  RotateCcw,
  TriangleAlert
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ManagementEmptyState,
  ManagementPageHeader,
  ManagementSectionHeader
} from "@/components/management-ui";
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
  icon: typeof TriangleAlert;
};

const definitions: AlertDefinition[] = [
  {
    key: "reconciliation_divergences",
    title: "Divergências de conciliação",
    description: "Registros financeiros ainda não resolvidos.",
    href: "/gerencia/financeiro",
    action: "Abrir financeiro",
    icon: CircleDollarSign
  },
  {
    key: "failed_commission_payments",
    title: "Pagamentos de comissão com falha",
    description: "Falhas que exigem conferência antes de uma nova tentativa.",
    href: "/gerencia/pagamentos",
    action: "Revisar pagamentos",
    icon: BadgeAlert
  },
  {
    key: "critical_stock",
    title: "Estoque crítico",
    description: "Variações no estoque mínimo ou abaixo dele.",
    href: "/gerencia/relatorios",
    action: "Abrir relatórios",
    icon: Boxes
  },
  {
    key: "refunds_in_period",
    title: "Pedidos reembolsados",
    description: "Reembolsos registrados nos últimos 30 dias.",
    href: "/gerencia/pedidos-vendas",
    action: "Ver pedidos",
    icon: RotateCcw
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

  return (
    <section className="management-page manager-alert-center" aria-busy={loading}>
      <ManagementPageHeader
        title="Alertas gerenciais"
        description="Ocorrências reais que precisam de acompanhamento nas áreas responsáveis."
        actions={<button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} aria-hidden="true" /> Atualizar</button>}
      />
      {error ? <ManagementEmptyState icon={TriangleAlert} title="Alertas indisponíveis" description={error} action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Tentar novamente</button>} /> : null}
      {!error && !loading && total === 0 ? <ManagementEmptyState icon={BadgeAlert} title="Nenhum alerta pendente" description="Não há divergências, falhas, estoque crítico ou reembolsos no recorte atual." /> : null}
      {!error && (loading || total > 0) ? <section className="panel-card">
        <ManagementSectionHeader title="Prioridades" description="Cada item direciona para o fluxo operacional correspondente." />
        <div className="manager-alert-grid">
          {definitions.map((definition) => {
            const Icon = definition.icon;
            const value = numeric(alerts[definition.key]);
            return <article key={definition.key} className={value ? "manager-alert-item is-active" : "manager-alert-item"}>
              <Icon aria-hidden="true" />
              <div><span>{definition.title}</span><strong>{loading ? "—" : value.toLocaleString("pt-BR")}</strong><p>{definition.description}</p></div>
              <Link href={definition.href}>{definition.action}</Link>
            </article>;
          })}
        </div>
      </section> : null}
    </section>
  );
}
