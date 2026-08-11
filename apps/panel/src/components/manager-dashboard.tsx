"use client";

import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  CircleDollarSign,
  LoaderCircle,
  RotateCcw,
  ShoppingBag,
  TriangleAlert
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { RevenueChart, type RevenuePoint } from "@/components/revenue-chart";

type RecordValue = Record<string, unknown>;
type Option = { id: string; name: string };
type RepresentativeOption = { id: string; public_code: string; region_code?: string };

type DashboardResponse = {
  demo?: boolean;
  metrics?: RecordValue;
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
const inputDate = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
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
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { from: inputDate.format(start), to: inputDate.format(end) };
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
  const [metrics, setMetrics] = useState<RecordValue>({});
  const [options, setOptions] = useState<NonNullable<DashboardResponse["options"]>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [demo, setDemo] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams();
    Object.entries(submitted).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    try {
      const response = await fetch(`/api/manager/dashboard?${params}`, { cache: "no-store" });
      const payload = parseResponse(await response.json());
      if (!response.ok) throw new Error(payload.message);
      setMetrics(isRecord(payload.metrics) ? payload.metrics : {});
      setOptions(payload.options ?? {});
      setDemo(payload.demo === true);
    } catch {
      setMessage("Não foi possível carregar os indicadores gerenciais agora.");
    } finally {
      setLoading(false);
    }
  }, [submitted]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
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

  return (
    <div className="manager-dashboard">
      <form
        className="panel-card manager-filters"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setSubmitted(filters);
        }}
      >
        <label>
          De
          <input type="date" value={filters.from} onChange={(event) => update("from", event.target.value)} required />
        </label>
        <label>
          Até
          <input type="date" value={filters.to} onChange={(event) => update("to", event.target.value)} required />
        </label>
        <Filter label="Região" value={filters.region} onChange={(value) => update("region", value)} options={(options.regions ?? []).map((region) => ({ id: region, name: region }))} />
        <Filter label="Produto" value={filters.product} onChange={(value) => update("product", value)} options={options.products ?? []} />
        <Filter label="Categoria" value={filters.category} onChange={(value) => update("category", value)} options={options.categories ?? []} />
        <Filter label="Modelo" value={filters.model} onChange={(value) => update("model", value)} options={options.models ?? []} />
        <Filter label="Representante" value={filters.representative} onChange={(value) => update("representative", value)} options={(options.representatives ?? []).map((item) => ({ id: item.id, name: item.public_code }))} />
        <Filter label="Nível" value={filters.level} onChange={(value) => update("level", value)} options={options.levels ?? []} />
        <Filter label="Campanha" value={filters.campaign} onChange={(value) => update("campaign", value)} options={options.campaigns ?? []} />
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? <LoaderCircle className="spin" aria-hidden="true" /> : <ChartNoAxesCombined aria-hidden="true" />}
          Aplicar
        </button>
      </form>

      {message ? <p className="admin-feedback" role="alert">{message}</p> : null}
      {demo ? <p className="admin-feedback" role="status">Ambiente de demonstração: indicadores financeiros reais não são exibidos.</p> : null}

      <div className="manager-metric-grid" aria-busy={loading}>
        <ManagerMetric icon={<BadgeDollarSign />} label="Faturamento bruto" value={loading || demo ? "—" : cents(metrics.gross_cents)} detail={trend} />
        <ManagerMetric icon={<CircleDollarSign />} label="Faturamento líquido" value={loading || demo ? "—" : cents(metrics.net_cents)} detail="Após taxas e custo de frete registrado" />
        <ManagerMetric icon={<ChartNoAxesCombined />} label="Lucro estimado" value={loading || demo ? "—" : cents(metrics.estimated_profit_cents)} detail="Com custos persistidos nos pedidos" />
        <ManagerMetric icon={<RotateCcw />} label="Reembolsos" value={loading || demo ? "—" : cents(metrics.refunds_cents)} detail={`${count(alerts, "refunds_in_period")} pedido(s) no período`} />
        <ManagerMetric icon={<ShoppingBag />} label="Pedidos" value={loading || demo ? "—" : numberValue(metrics.orders).toLocaleString("pt-BR")} detail={`Ticket médio ${demo ? "—" : cents(metrics.average_ticket_cents)}`} />
      </div>

      <div className="manager-dashboard-columns">
        <section className="panel-card">
          <h2>Faturamento ao longo do tempo</h2>
          {loading ? <div className="admin-loading"><LoaderCircle className="spin" /> Consolidando dados</div> : <RevenueChart data={series} />}
        </section>
        <section className="panel-card">
          <h2>Aprovações pendentes</h2>
          <DashboardLink href="/gerencia/solicitacoes-representantes" label="Representantes" value={count(pending, "applications")} />
          <DashboardLink href="/gerencia/criativos" label="Criativos" value={count(pending, "creatives")} />
          <DashboardLink href="/gerencia/campanhas" label="Campanhas" value={count(pending, "campaigns")} />
          <DashboardLink href="/gerencia/fechamentos" label="Fechamentos" value={count(pending, "closings")} />
        </section>
      </div>

      <section className="panel-card manager-overview">
        <h2>Visão estratégica</h2>
        <div className="manager-overview-grid">
          <Overview label="Novos clientes" value={count(overview, "customers")} />
          <Overview label="Representantes ativos" value={count(overview, "active_representatives")} />
          <Overview label="Crescimento da rede" value={count(overview, "network_growth")} detail="novos no período" />
          <Overview label="Pedidos de kits" value={count(overview, "kits")} detail={cents(isRecord(overview) ? overview.kits_cents : 0)} />
          <Overview label="Estoque crítico" value={count(overview, "critical_stock")} detail="variações no mínimo" />
          <Overview label="Comissões" value={cents(isRecord(overview) ? overview.commissions_cents : 0)} />
          <Overview label="Qualificações" value={count(overview, "qualified_representatives")} detail="resultados positivos" />
          <Overview label="Níveis ativos" value={count(overview, "active_levels")} />
          <Overview label="Campanhas ativas" value={count(overview, "active_campaigns")} />
          <Overview label="Eventos de marketing/home" value={count(overview, "homepage_events")} detail="eventos registrados" />
        </div>
      </section>

      <section className="panel-card manager-alerts">
        <h2><TriangleAlert aria-hidden="true" /> Alertas gerenciais</h2>
        <div className="admin-compact-list">
          <div><span>Divergências de conciliação<small>Registros financeiros ainda não resolvidos</small></span><strong>{count(alerts, "reconciliation_divergences")}</strong></div>
          <div><span>Pagamentos de comissão com falha<small>Exigem conferência antes de nova tentativa</small></span><strong>{count(alerts, "failed_commission_payments")}</strong></div>
          <div><span>Estoque crítico<small>Variações no estoque mínimo ou abaixo dele</small></span><strong>{count(alerts, "critical_stock")}</strong></div>
        </div>
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

function ManagerMetric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <article className="admin-metric">{icon}<span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function DashboardLink({ href, label, value }: { href: string; label: string; value: number }) {
  return <Link className="compact-item manager-dashboard-link" href={href}><span><strong>{label}</strong><small>Abrir fila relacionada</small></span><strong>{value}</strong></Link>;
}

function Overview({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <article><span>{label}</span><strong>{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}
