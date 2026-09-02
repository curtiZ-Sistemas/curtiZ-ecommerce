"use client";

import {
  BadgeDollarSign,
  HandCoins,
  ChartNoAxesCombined,
  CircleDollarSign,
  LoaderCircle,
  RotateCcw,
  ShoppingBag,
  SlidersHorizontal,
  Users
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { RevenueChart, type RevenuePoint } from "@/components/revenue-chart";
import {
  ManagementMetricCard,
  ManagementPageHeader,
  ManagementPeriodSelect,
  ManagementSectionHeader
} from "@/components/management-ui";
import {
  managementPeriodFor,
  type ManagementPeriodPreset
} from "@/lib/management-period";

type RecordValue = Record<string, unknown>;
type Option = { id: string; name: string };
type RepresentativeOption = { id: string; public_code: string; region_code?: string };

type DashboardResponse = {
  demo?: boolean;
  metrics?: RecordValue;
  financial?: RecordValue;
  options?: {
    products?: Option[];
    categories?: Option[];
    models?: Option[];
    representatives?: RepresentativeOption[];
    levels?: Option[];
    campaigns?: Option[];
    regions?: string[];
  };
  message?: string;
  warnings?: string[];
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2
});
const dayLabel = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Sao_Paulo"
});
function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function cents(value: unknown): string {
  return money.format(numberValue(value) / 100);
}

function count(record: unknown, key: string): number {
  return isRecord(record) ? numberValue(record[key]) : 0;
}

function parseResponse(value: unknown): DashboardResponse {
  return isRecord(value) ? value : {};
}

function initialDates() {
  return managementPeriodFor("30days");
}

export function ManagerDashboard() {
  const dates = initialDates();
  const [filters, setFilters] = useState({
    ...dates,
    region: "",
    product: "",
    category: "",
    model: "",
    representative: "",
    level: "",
    campaign: ""
  });
  const [submitted, setSubmitted] = useState(filters);
  const [preset, setPreset] = useState<ManagementPeriodPreset>("30days");
  const [metrics, setMetrics] = useState<RecordValue>({});
  const [financial, setFinancial] = useState<RecordValue>({});
  const [options, setOptions] = useState<NonNullable<DashboardResponse["options"]>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [demo, setDemo] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const optionsLoaded = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams();
    Object.entries(submitted).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    if (optionsLoaded.current) params.set("includeOptions", "0");

    try {
      const response = await fetch(`/api/manager/dashboard?${params}`, { cache: "no-store" });
      const payload = parseResponse(await response.json());
      if (!response.ok) throw new Error(payload.message);
      setMetrics(isRecord(payload.metrics) ? payload.metrics : {});
      setFinancial(isRecord(payload.financial) ? payload.financial : {});
      if (payload.options) {
        setOptions(payload.options);
        optionsLoaded.current = true;
      }
      setDemo(payload.demo === true);
      setWarnings(Array.isArray(payload.warnings) ? payload.warnings.filter((item): item is string => typeof item === "string") : []);
    } catch {
      setMetrics({});
      setFinancial({});
      setDemo(false);
      setWarnings([]);
      setMessage("Não foi possível carregar os indicadores gerenciais agora.");
    } finally {
      setLoading(false);
    }
  }, [submitted]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (key: keyof typeof filters, value: string) => {
    if (key === "from" || key === "to") setPreset("custom");
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const changePreset = (next: ManagementPeriodPreset) => {
    setPreset(next);
    if (next === "custom") return;
    const period = managementPeriodFor(next);
    const updated = { ...filters, ...period };
    setFilters(updated);
    setSubmitted(updated);
  };
  const advancedFilterCount = [
    filters.region,
    filters.product,
    filters.category,
    filters.model,
    filters.representative,
    filters.level,
    filters.campaign
  ].filter(Boolean).length;
  const filtersChanged =
    advancedFilterCount > 0 || filters.from !== dates.from || filters.to !== dates.to;
  const clearFilters = () => {
    const next = {
      ...dates,
      region: "",
      product: "",
      category: "",
      model: "",
      representative: "",
      level: "",
      campaign: ""
    };
    setPreset("30days");
    setFilters(next);
    setSubmitted(next);
  };
  const series: RevenuePoint[] = Array.isArray(metrics.series)
    ? metrics.series.flatMap((item) => {
        if (!isRecord(item) || typeof item.day !== "string") return [];
        const parsed = new Date(`${item.day}T12:00:00-03:00`);
        return [
          {
            date: Number.isNaN(parsed.getTime()) ? item.day : dayLabel.format(parsed),
            gross: numberValue(item.gross_cents) / 100,
            net: numberValue(item.net_cents) / 100
          }
        ];
      })
    : [];
  const change = metrics.gross_change_percent;
  const trend =
    typeof change === "number"
      ? `${change > 0 ? "+" : ""}${change.toLocaleString("pt-BR")}% vs. período anterior`
      : "Sem base anterior comparável";
  const pending = metrics.pending;
  const alerts = metrics.alerts;
  const overview = metrics.overview;
  const hasLoadError = Boolean(message);

  return (
    <div className="manager-dashboard">
      <ManagementPageHeader
        title="Dashboard executivo"
        description="Situação atual da curti Z, pendências prioritárias e desempenho do período."
      />
      <form
        className="panel-card manager-filters"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setSubmitted(filters);
        }}
      >
        <div className="manager-filter-primary">
          <ManagementPeriodSelect value={preset} onChange={changePreset} disabled={loading} />
          <label>
            De
            <input type="date" value={filters.from} onChange={(event) => update("from", event.target.value)} required />
          </label>
          <label>
            Até
            <input type="date" value={filters.to} onChange={(event) => update("to", event.target.value)} required />
          </label>
          <div className="manager-filter-actions">
            {filtersChanged ? (
              <button className="secondary-button" type="button" onClick={clearFilters} disabled={loading}>
                <RotateCcw aria-hidden="true" /> Limpar
              </button>
            ) : null}
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? <LoaderCircle className="spin" aria-hidden="true" /> : <ChartNoAxesCombined aria-hidden="true" />}
              {advancedFilterCount ? "Aplicar filtros" : "Aplicar período"}
            </button>
          </div>
        </div>
        <details className="manager-advanced-filters">
          <summary>
            <span><SlidersHorizontal aria-hidden="true" /> Filtros avançados</span>
            <small>{advancedFilterCount ? `${advancedFilterCount} ativo(s)` : "Produto, região, rede e campanha"}</small>
          </summary>
          <div>
            <Filter label="Região" value={filters.region} onChange={(value) => update("region", value)} options={(options.regions ?? []).map((region) => ({ id: region, name: region }))} />
            <Filter label="Produto" value={filters.product} onChange={(value) => update("product", value)} options={options.products ?? []} />
            <Filter label="Categoria" value={filters.category} onChange={(value) => update("category", value)} options={options.categories ?? []} />
            <Filter label="Modelo" value={filters.model} onChange={(value) => update("model", value)} options={options.models ?? []} />
            <Filter label="Representante" value={filters.representative} onChange={(value) => update("representative", value)} options={(options.representatives ?? []).map((item) => ({ id: item.id, name: item.public_code }))} />
            <Filter label="Nível" value={filters.level} onChange={(value) => update("level", value)} options={options.levels ?? []} />
            <Filter label="Campanha" value={filters.campaign} onChange={(value) => update("campaign", value)} options={options.campaigns ?? []} />
          </div>
        </details>
      </form>

      {message ? <div className="admin-empty-state" role="alert"><p>{message}</p><button className="secondary-button" type="button" onClick={() => void load()}><RotateCcw aria-hidden="true" /> Tentar novamente</button></div> : null}
      {demo ? <p className="admin-feedback" role="status">Ambiente de demonstração: indicadores financeiros reais não são exibidos.</p> : null}
      {warnings.length ? <p className="admin-feedback" role="alert">Filtros parcialmente indisponíveis: {warnings.join(", ")}.</p> : null}

      <div className="management-metric-grid manager-executive-metrics" aria-busy={loading}>
        <ManagementMetricCard icon={BadgeDollarSign} label="Faturamento bruto" value={loading || demo || hasLoadError ? "—" : cents(metrics.gross_cents)} detail={trend} />
        <ManagementMetricCard icon={CircleDollarSign} label="Faturamento líquido" value={loading || demo || hasLoadError ? "—" : cents(metrics.net_cents)} detail="Após taxas e frete registrados" />
        <ManagementMetricCard icon={ChartNoAxesCombined} label="Lucro estimado" value={loading || demo || hasLoadError ? "—" : cents(metrics.estimated_profit_cents)} detail="Conforme custos persistidos" />
        <ManagementMetricCard icon={ShoppingBag} label="Pedidos" value={loading || demo || hasLoadError ? "—" : numberValue(metrics.orders).toLocaleString("pt-BR")} detail={`Ticket médio ${demo || hasLoadError ? "—" : cents(metrics.average_ticket_cents)}`} />
        <ManagementMetricCard icon={RotateCcw} label="Reembolsos" value={loading || demo || hasLoadError ? "—" : cents(metrics.refunds_cents)} detail={hasLoadError ? "Dados indisponíveis" : `${count(alerts, "refunds_in_period")} pedido(s) no período`} tone={count(alerts, "refunds_in_period") ? "warning" : "neutral"} />
        <ManagementMetricCard icon={HandCoins} label="A receber" value={loading || demo || hasLoadError ? "—" : cents(financial.receivable_cents)} detail={`${cents(financial.overdue_receivable_cents)} vencidos`} tone={numberValue(financial.overdue_receivable_cents) > 0 ? "warning" : "neutral"} />
        <ManagementMetricCard icon={CircleDollarSign} label="A pagar" value={loading || demo || hasLoadError ? "—" : cents(financial.payable_cents)} detail={`${cents(financial.overdue_payable_cents)} vencidos`} tone={numberValue(financial.overdue_payable_cents) > 0 ? "danger" : "neutral"} />
        <ManagementMetricCard icon={Users} label="Representantes ativos" value={loading || demo || hasLoadError ? "—" : count(overview, "active_representatives").toLocaleString("pt-BR")} detail={`${count(overview, "network_growth")} novos no período`} />
      </div>

      <div className="manager-dashboard-columns">
        <section className="panel-card">
          <ManagementSectionHeader title="Faturamento ao longo do tempo" description="Receita bruta e líquida do período selecionado." />
          {loading ? <div className="admin-loading"><LoaderCircle className="spin" /> Consolidando dados</div> : hasLoadError ? <p className="admin-empty-copy">Série indisponível.</p> : <RevenueChart data={series} />}
        </section>
        <section className="panel-card">
          <ManagementSectionHeader title="Aprovações pendentes" description="Filas que exigem decisão gerencial." />
          {hasLoadError ? <p className="admin-empty-copy">Filas indisponíveis.</p> : <>
            <DashboardLink href="/gerencia/solicitacoes-representantes" label="Representantes" value={count(pending, "applications")} />
            <DashboardLink href="/gerencia/criativos" label="Criativos" value={count(pending, "creatives")} />
            <DashboardLink href="/gerencia/campanhas" label="Campanhas" value={count(pending, "campaigns")} />
            <DashboardLink href="/gerencia/fechamentos" label="Fechamentos" value={count(pending, "closings")} />
          </>}
        </section>
      </div>

      <section className="panel-card manager-alerts">
        <ManagementSectionHeader title="Alertas prioritários" description="Ocorrências que podem afetar caixa, comissão ou estoque." action={<Link className="secondary-button" href="/gerencia/alertas">Ver todos</Link>} />
        {hasLoadError ? <p className="admin-empty-copy">Alertas indisponíveis.</p> : <div className="admin-compact-list">
          <div><span>Divergências de conciliação<small>Registros financeiros ainda não resolvidos</small></span><strong>{count(alerts, "reconciliation_divergences")}</strong></div>
          <div><span>Pagamentos de comissão com falha<small>Exigem conferência antes de nova tentativa</small></span><strong>{count(alerts, "failed_commission_payments")}</strong></div>
          <div><span>Estoque crítico<small>Variações no estoque mínimo ou abaixo dele</small></span><strong>{count(alerts, "critical_stock")}</strong></div>
        </div>}
      </section>
    </div>
  );
}

function Filter({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Todos</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  );
}

function DashboardLink({ href, label, value }: { href: string; label: string; value: number }) {
  return <Link className="compact-item manager-dashboard-link" href={href}><span><strong>{label}</strong><small>Abrir fila relacionada</small></span><strong>{value}</strong></Link>;
}
