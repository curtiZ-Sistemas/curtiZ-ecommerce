import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  managementPeriodOptions,
  type ManagementPeriodPreset
} from "@/lib/management-period";

export function ManagementPageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="management-page-header">
      <div>
        <span className="page-heading-eyebrow">Gerência</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="management-page-actions">{actions}</div> : null}
    </header>
  );
}

export function ManagementMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral"
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "positive" | "warning" | "danger";
}) {
  return (
    <article className={`management-metric management-metric-${tone}`}>
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function ManagementSectionHeader({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="management-section-header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
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
      Período
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
  icon: Icon,
  title,
  description,
  action
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="admin-empty-state management-empty-state">
      <Icon aria-hidden="true" />
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
