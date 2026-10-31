import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  managementPeriodOptions,
  type ManagementPeriodPreset
} from "@/lib/management-period";
import { PageHeader, SectionHeader, StateMessage, type UiTone } from "@/components/panel-ui";

// Componentes do Painel Gerencial sobre os primitivos de panel-ui.tsx (linguagem "Etiqueta").

// Aparência comum dos gráficos (Recharts): eixos discretos de 12px, tooltip branco com borda fina.
export const chartAxisTick = { fontSize: 12, fill: "var(--muted)" };
export const chartLegendStyle = { fontSize: 12, color: "var(--neutral-700)", paddingTop: 8 };
export const chartTooltipProps = {
  contentStyle: {
    border: "1px solid var(--line)",
    borderRadius: 5,
    background: "var(--surface)",
    boxShadow: "none",
    fontSize: 13
  },
  labelStyle: { color: "var(--ink)", fontWeight: 600 },
  itemStyle: { padding: 0 },
  cursor: { stroke: "var(--line-strong)" }
};

export function ManagementPageHeader({
  title,
  description,
  actions,
  meta
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return <PageHeader title={title} description={description} actions={actions} meta={meta} />;
}

type MetricTone = "neutral" | "positive" | "warning" | "danger";

const metricTones: Record<MetricTone, UiTone> = {
  neutral: "neutral",
  positive: "success",
  warning: "warning",
  danger: "danger"
};

/** Item de uma faixa de indicadores. Use dentro de <KpiStrip />; o ícone não é exibido. */
export function ManagementMetricCard({
  label,
  value,
  detail,
  tone = "neutral"
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: MetricTone;
}) {
  const uiTone = metricTones[tone];
  return (
    <div className="ui-kpi" data-tone={uiTone === "neutral" ? undefined : uiTone}>
      <dt>{label}</dt>
      <dd className="ui-kpi-value ui-num">{value}</dd>
      <dd className="ui-kpi-detail">{detail}</dd>
    </div>
  );
}

export function ManagementSectionHeader({
  title,
  description,
  action,
  level,
  id
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  level?: 2 | 3;
  id?: string;
}) {
  return <SectionHeader title={title} description={description} actions={action} level={level} id={id} />;
}

export function ManagementPeriodSelect({
  value,
  onChange,
  disabled
}: {
  value: ManagementPeriodPreset;
  onChange: (value: ManagementPeriodPreset) => void;
  disabled?: boolean;
}) {
  return (
    <label className="management-period-select">
      <span>Período</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ManagementPeriodPreset)}
        disabled={disabled}
      >
        {managementPeriodOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ManagementEmptyState({
  icon,
  title,
  description,
  action,
  kind = "empty"
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  kind?: "empty" | "error" | "unavailable";
}) {
  return (
    <div className="management-empty-state">
      <StateMessage kind={kind} icon={icon} title={title} description={description} action={action} />
    </div>
  );
}
