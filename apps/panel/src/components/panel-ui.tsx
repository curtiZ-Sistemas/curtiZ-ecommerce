import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

// Primitivos visuais da linguagem "Etiqueta". Sem estado e compatíveis com Server Components.
// Estilos em app/styles/foundation.css (classes ui-*). Dono: Agente 1.

export type UiTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export function PageHeader({
  title,
  description,
  actions,
  meta,
  titleId
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  titleId?: string;
}) {
  return (
    <header className="ui-page-header">
      <div>
        <h1 id={titleId}>{title}</h1>
        {description ? <p>{description}</p> : null}
        {meta ? <div className="ui-page-header-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="ui-page-header-actions">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  id,
  level = 2
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  level?: 2 | 3;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div className="ui-section-header">
      <div>
        <Heading id={id}>{title}</Heading>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ui-section-header-actions">{actions}</div> : null}
    </div>
  );
}

/** Faixa de indicadores. Filhos devem ser <Kpi />. */
export function KpiStrip({ label, busy, children }: { label?: string; busy?: boolean; children: ReactNode }) {
  return (
    <dl className="ui-kpis" aria-label={label} aria-busy={busy || undefined}>
      {children}
    </dl>
  );
}

/** Um indicador: rótulo, número e contexto. Com href, o bloco inteiro vira link. */
export function Kpi({
  label,
  value,
  detail,
  tone = "neutral",
  href
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: UiTone;
  href?: string;
}) {
  return (
    <div className="ui-kpi" data-tone={tone === "neutral" ? undefined : tone}>
      <dt>{href ? <Link className="ui-kpi-link" href={href}>{label}</Link> : label}</dt>
      <dd className="ui-kpi-value ui-num">{value}</dd>
      {detail ? <dd className="ui-kpi-detail">{detail}</dd> : null}
    </div>
  );
}

/** Etiqueta de status: sempre com texto; o tom reforça, nunca substitui. */
export function StatusLabel({ tone = "neutral", icon: Icon, children }: { tone?: UiTone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className="ui-label" data-tone={tone}>
      {Icon ? <Icon aria-hidden="true" /> : <span className="ui-label-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Vazio, erro ou indisponível: o que aconteceu, por quê e a próxima ação. */
export function StateMessage({
  kind = "empty",
  title,
  description,
  action,
  icon: Icon,
  compact,
  level = 2
}: {
  kind?: "empty" | "error" | "unavailable";
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  compact?: boolean;
  level?: 2 | 3;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div className="ui-state" data-kind={kind} data-compact={compact || undefined} role={kind === "error" ? "alert" : undefined}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      <Heading>{title}</Heading>
      {description ? <p>{description}</p> : null}
      {action ? <div className="ui-state-actions">{action}</div> : null}
    </div>
  );
}

/** Carregamento com a geometria aproximada da lista que vai aparecer. */
export function LoadingBlock({ label = "Carregando…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="ui-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span className="ui-skeleton" aria-hidden="true" key={index} />
      ))}
    </div>
  );
}

/** Barra de busca e filtros. sticky fixa a barra abaixo da topbar durante a rolagem. */
export function Toolbar({ label, sticky, children }: { label?: string; sticky?: boolean; children: ReactNode }) {
  return (
    <div className="ui-toolbar" role={label ? "group" : undefined} aria-label={label} data-sticky={sticky || undefined}>
      {children}
    </div>
  );
}

/** Código de pedido, SKU, ID ou correlação em fonte mono. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="ui-code">{children}</code>;
}
