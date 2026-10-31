"use client";

import { RefreshCw } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  ManagementEmptyState,
  ManagementMetricCard,
  ManagementPageHeader,
  ManagementPeriodSelect,
  ManagementSectionHeader
} from "@/components/management-ui";
import { Code, KpiStrip, LoadingBlock } from "@/components/panel-ui";
import { StrategyChart, type StrategyPoint } from "@/components/strategy-chart";
import {
  managementPeriodFor,
  type ManagementPeriodPreset
} from "@/lib/management-period";

type Row = Record<string, unknown>;
type StrategyData = {
  comparison: { current: Row; previous: Row };
  series: Row[];
  products: Row[];
  categories: Row[];
  regions: Row[];
  representatives: Row[];
  campaigns: Row[];
  goals: Row[];
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Sao_Paulo"
});
const fullDate = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: "America/Sao_Paulo"
});

function record(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Object.keys(record(item)).length > 0) : [];
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function cents(value: unknown) {
  return money.format(numeric(value) / 100);
}

function formattedDate(value: unknown) {
  if (typeof value !== "string") return "—";
  const parsed = new Date(`${value}T12:00:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? "—" : fullDate.format(parsed);
}

function statusText(value: unknown) {
  const key = text(value, "");
  const localized = ({ published: "Publicada", scheduled: "Agendada", approved: "Aprovada", draft: "Rascunho" } as Record<string, string>)[key];
  return localized ?? (key || "—");
}

function jsonText(value: unknown) {
  if (value === null || typeof value !== "object") return "—";
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}

function change(current: number, previous: number) {
  return previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100;
}

function changeLabel(current: unknown, previous: unknown) {
  const variation = change(numeric(current), numeric(previous));
  if (variation === null) return "Sem base anterior comparável";
  return `${variation > 0 ? "+" : ""}${variation.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. período anterior`;
}

function parseStrategy(value: unknown): { data: StrategyData; demo: boolean; message?: string } {
  const payload = record(value);
  const raw = record(payload.data);
  const comparison = record(raw.comparison);
  return {
    demo: payload.demo === true,
    message: typeof payload.message === "string" ? payload.message : undefined,
    data: {
      comparison: { current: record(comparison.current), previous: record(comparison.previous) },
      series: rows(raw.series),
      products: rows(raw.products),
      categories: rows(raw.categories),
      regions: rows(raw.regions),
      representatives: rows(raw.representatives),
      campaigns: rows(raw.campaigns),
      goals: rows(raw.goals)
    }
  };
}

const emptyData: StrategyData = {
  comparison: { current: {}, previous: {} },
  series: [],
  products: [],
  categories: [],
  regions: [],
  representatives: [],
  campaigns: [],
  goals: []
};

export function ManagerStrategy() {
  const initial = managementPeriodFor("month");
  const [preset, setPreset] = useState<ManagementPeriodPreset>("month");
  const [dates, setDates] = useState(initial);
  const [submitted, setSubmitted] = useState(initial);
  const [data, setData] = useState<StrategyData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams(submitted);
      const response = await fetch(`/api/manager/strategy?${params}`, { cache: "no-store" });
      const payload = parseStrategy(await response.json());
      if (!response.ok) throw new Error(payload.message);
      setData(payload.data);
      setDemo(payload.demo);
    } catch (loadError) {
      setData(emptyData);
      setError(loadError instanceof Error && loadError.message
        ? loadError.message
        : "Não foi possível carregar a visão estratégica.");
    } finally {
      setLoading(false);
    }
  }, [submitted]);

  useEffect(() => { void load(); }, [load]);

  const current = data.comparison.current;
  const previous = data.comparison.previous;
  const chartData: StrategyPoint[] = data.series.flatMap((item) => {
    if (typeof item.day !== "string") return [];
    const parsed = new Date(`${item.day}T12:00:00-03:00`);
    return [{
      date: Number.isNaN(parsed.getTime()) ? item.day : shortDate.format(parsed),
      gross: numeric(item.gross_cents) / 100,
      profit: numeric(item.profit_cents) / 100
    }];
  });
  const productRows = useMemo<Array<Row & { variation: number | null }>>(() => data.products
    .map((item): Row & { variation: number | null } => ({
      ...item,
      variation: change(numeric(item.current_revenue_cents), numeric(item.previous_revenue_cents))
    }))
    .sort((left, right) => numeric(right.current_revenue_cents) - numeric(left.current_revenue_cents)), [data.products]);
  const declining = productRows
    .filter((item) => item.variation !== null && item.variation < 0)
    .sort((left, right) => (left.variation ?? 0) - (right.variation ?? 0))
    .slice(0, 6);

  const changePreset = (next: ManagementPeriodPreset) => {
    setPreset(next);
    if (next === "custom") return;
    const period = managementPeriodFor(next);
    setDates(period);
    setSubmitted(period);
  };

  return (
    <section className="management-page manager-strategy" aria-busy={loading}>
      <ManagementPageHeader
        title="Visão estratégica"
        description="Tendências comerciais e comparação objetiva com o período anterior."
      />
      <form className="management-period-bar management-period-inline" aria-label="Período da análise" onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setSubmitted(dates);
      }}>
        <ManagementPeriodSelect value={preset} onChange={changePreset} disabled={loading} />
        {preset === "custom" ? <>
          <label className="management-field"><span>De</span><input type="date" value={dates.from} onChange={(event) => setDates((value) => ({ ...value, from: event.target.value }))} required /></label>
          <label className="management-field"><span>Até</span><input type="date" value={dates.to} onChange={(event) => setDates((value) => ({ ...value, to: event.target.value }))} required /></label>
          <button className="primary-button" type="submit" disabled={loading}>Aplicar</button>
        </> : null}
        <button className="icon-button" type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar visão estratégica" title="Atualizar visão estratégica">
          <RefreshCw className={loading ? "spin" : ""} aria-hidden="true" />
        </button>
      </form>

      {error ? <ManagementEmptyState kind="error" title="Análise indisponível" description={error} action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Tentar novamente</button>} /> : null}
      {demo ? <p className="admin-feedback info" role="status">Ambiente de demonstração: nenhum dado comercial real é exibido.</p> : null}

      {!error ? <>
        <KpiStrip label="Indicadores do período" busy={loading}>
          <ManagementMetricCard label="Faturamento bruto" value={loading || demo ? "—" : cents(current.gross_cents)} detail={changeLabel(current.gross_cents, previous.gross_cents)} />
          <ManagementMetricCard label="Faturamento líquido" value={loading || demo ? "—" : cents(current.net_cents)} detail={changeLabel(current.net_cents, previous.net_cents)} />
          <ManagementMetricCard label="Lucro estimado" value={loading || demo ? "—" : cents(current.profit_cents)} detail={changeLabel(current.profit_cents, previous.profit_cents)} />
          <ManagementMetricCard label="Pedidos" value={loading || demo ? "—" : numeric(current.orders).toLocaleString("pt-BR")} detail={changeLabel(current.orders, previous.orders)} />
        </KpiStrip>

        <section className="panel-card management-chart-card" aria-labelledby="strategy-chart-title">
          <ManagementSectionHeader id="strategy-chart-title" title="Evolução comercial" description="Faturamento bruto e lucro estimado no período selecionado." />
          {loading ? <div className="management-chart-loading"><LoadingBlock label="Consolidando tendências" rows={1} /></div> : <StrategyChart data={chartData} />}
        </section>

        <div className="management-two-columns">
          <StrategyTable title="Produtos em destaque" description="Maior receita no período." rows={productRows.slice(0, 8)} columns={[
            ["Produto", (row) => text(row.name)],
            ["Receita", (row) => cents(row.current_revenue_cents), "num"],
            ["Unidades", (row) => numeric(row.current_units).toLocaleString("pt-BR"), "num"],
            ["Evolução", (row) => typeof row.variation !== "number" ? "—" : <Variation value={row.variation} />, "num"]
          ]} />
          <StrategyTable title="Produtos em retração" description="Quedas que merecem investigação comercial." rows={declining} columns={[
            ["Produto", (row) => text(row.name)],
            ["Atual", (row) => cents(row.current_revenue_cents), "num"],
            ["Anterior", (row) => cents(row.previous_revenue_cents), "num"],
            ["Variação", (row) => <Variation value={numeric(row.variation)} />, "num"]
          ]} />
        </div>

        <div className="management-two-columns">
          <StrategyTable title="Categorias" rows={data.categories} columns={[["Categoria", (row) => text(row.name)], ["Receita", (row) => cents(row.current_revenue_cents), "num"], ["Unidades", (row) => numeric(row.current_units).toLocaleString("pt-BR"), "num"]]} />
          <StrategyTable title="Regiões" rows={data.regions} columns={[["Região", (row) => text(row.name)], ["Receita", (row) => cents(row.revenue_cents), "num"], ["Vendas", (row) => numeric(row.sales).toLocaleString("pt-BR"), "num"]]} />
          <StrategyTable title="Representantes" rows={data.representatives} columns={[["Representante", (row) => text(row.name)], ["Código", (row) => <Code>{text(row.public_code)}</Code>], ["Receita", (row) => cents(row.revenue_cents), "num"], ["Vendas", (row) => numeric(row.sales).toLocaleString("pt-BR"), "num"]]} />
          <StrategyTable title="Campanhas" rows={data.campaigns} columns={[["Campanha", (row) => text(row.name)], ["Status", (row) => statusText(row.status)], ["Eventos", (row) => numeric(row.events).toLocaleString("pt-BR"), "num"]]} />
        </div>

        <StrategyTable title="Metas vigentes" description="Metas ativas que cruzam o período analisado." rows={data.goals} columns={[["Meta", (row) => text(row.title)], ["Escopo", (row) => text(row.scope)], ["Critério", (row) => <Code>{jsonText(row.target)}</Code>], ["Início", (row) => formattedDate(row.period_start)], ["Fim", (row) => formattedDate(row.period_end)]]} />
      </> : null}
    </section>
  );
}

/** Variação com sinal; queda também recebe texto de perigo (não só cor). */
function Variation({ value }: { value: number }) {
  const label = `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  return value < 0
    ? <span className="management-negative">{label}<span className="sr-only"> (queda)</span></span>
    : <>{label}</>;
}

type TableColumn = [string, (row: Row & { variation?: number | null }) => ReactNode, "num"?];

function StrategyTable({ title, description, rows: values, columns }: { title: string; description?: string; rows: Array<Row & { variation?: number | null }>; columns: TableColumn[] }) {
  return (
    <section className="panel-card management-table-card">
      <ManagementSectionHeader title={title} description={description} />
      {values.length ? <div className="management-table-wrap">
        <table className="data-table admin-data-table ui-table-stack">
          <thead><tr>{columns.map(([label, , kind]) => <th key={label} scope="col" className={kind === "num" ? "ui-num" : undefined}>{label}</th>)}</tr></thead>
          <tbody>{values.map((row, index) => <tr key={`${text(row.id ?? row.product_id ?? row.category_id ?? row.representative_id ?? row.campaign_id, "row")}-${index}`}>{columns.map(([label, render, kind]) => <td key={label} data-label={label} className={kind === "num" ? "ui-num" : undefined}>{render(row)}</td>)}</tr>)}</tbody>
        </table>
      </div> : <p className="management-inline-empty">Sem dados reais para este recorte.</p>}
    </section>
  );
}
