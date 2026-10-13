"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  chartAxisTick,
  chartLegendStyle,
  chartTooltipProps,
  ManagementEmptyState,
  ManagementMetricCard,
  ManagementPageHeader,
  ManagementSectionHeader
} from "@/components/management-ui";
import { KpiStrip, LoadingBlock, StatusLabel } from "@/components/panel-ui";

type Insights = {
  enabled: boolean;
  periodDays: number;
  overview: {
    views: number;
    favorites: number;
    cartAdds: number;
    recommendationClicks: number;
    unitsSold: number;
    revenue: number;
  };
  topProducts: Array<{
    productId: string;
    name: string;
    views: number;
    favorites: number;
    cartAdds: number;
    unitsSold: number;
  }>;
  searches: Array<{ query: string; searches: number; noResults: number; clicks: number }>;
  sources: Array<{ source: string; impressions: number; clicks: number }>;
  daily: Array<{ date: string; views: number; cartAdds: number; unitsSold: number }>;
  message?: string;
  demo?: boolean;
};

const count = (value: number) => Number(value ?? 0).toLocaleString("pt-BR");
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const day = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Sao_Paulo"
});

function percent(part: number, total: number, digits = 1) {
  return total > 0
    ? `${((part / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`
    : "—";
}

export function StoreIntelligence() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/manager/intelligence?days=${days}`, { cache: "no-store" });
      const result = (await response.json()) as Insights;
      if (!response.ok) throw new Error(result.message || "Não foi possível carregar os insights.");
      setData(result);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os insights.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const chart = (data?.daily ?? []).map((item) => {
    const parsed = new Date(`${item.date}T12:00:00-03:00`);
    return { ...item, label: Number.isNaN(parsed.getTime()) ? item.date : day.format(parsed) };
  });

  return (
    <section className="management-page store-intelligence" aria-busy={loading}>
      <ManagementPageHeader
        title="Inteligência da loja"
        description="Sinais agregados e consentidos para decisões de catálogo e descoberta. Compras entram somente após aprovação do pedido."
      />
      <div className="management-period-bar management-period-inline" role="group" aria-label="Período da análise">
        <label className="management-period-select">
          <span>Período</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} disabled={loading}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option></select>
        </label>
        <button className="icon-button" type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar inteligência da loja" title="Atualizar inteligência da loja"><RefreshCw className={loading ? "spin" : ""} aria-hidden="true" /></button>
      </div>

      {loading ? <div className="intelligence-loading"><LoadingBlock label="Consolidando indicadores…" rows={4} /></div> : null}
      {error ? <ManagementEmptyState kind="error" title="Insights indisponíveis" description={error} action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Tentar novamente</button>} /> : null}
      {data && !data.enabled ? <ManagementEmptyState kind="unavailable" title="Recurso pausado" description="A coleta de insights está desativada pela configuração do sistema." /> : null}

      {data?.enabled && !loading ? <>
        {data.demo ? <p className="admin-feedback info" role="status">Ambiente de demonstração: nenhum comportamento real de clientes é exibido.</p> : null}
        <KpiStrip label="Indicadores de comportamento">
          <ManagementMetricCard label="Visualizações" value={count(data.overview.views)} detail="Páginas de produto vistas" />
          <ManagementMetricCard label="Favoritos" value={count(data.overview.favorites)} detail={percent(data.overview.favorites, data.overview.views) + " das visualizações"} />
          <ManagementMetricCard label="Adições ao carrinho" value={count(data.overview.cartAdds)} detail={percent(data.overview.cartAdds, data.overview.views) + " de intenção"} />
          <ManagementMetricCard label="Cliques em recomendações" value={count(data.overview.recommendationClicks)} detail="Interações consentidas" />
          <ManagementMetricCard label="Unidades válidas" value={count(data.overview.unitsSold)} detail="Somente pedidos aprovados" />
          <ManagementMetricCard label="Receita validada" value={money.format(Number(data.overview.revenue ?? 0))} detail="Receita dos pedidos aprovados" />
        </KpiStrip>

        <section className="panel-card management-chart-card" aria-labelledby="intelligence-chart-title">
          <ManagementSectionHeader id="intelligence-chart-title" title="Jornada de intenção" description="Visualizações, carrinhos e unidades vendidas ao longo do período." />
          {chart.length ? <figure className="management-chart"><div className="management-chart-canvas" role="img" aria-label={`Evolução diária de visualizações, carrinhos e unidades vendidas nos últimos ${days} dias.`}><ResponsiveContainer><LineChart data={chart} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="label" tick={chartAxisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={16} /><YAxis tick={chartAxisTick} tickLine={false} axisLine={false} /><Tooltip {...chartTooltipProps} /><Legend wrapperStyle={chartLegendStyle} iconType="plainline" /><Line type="monotone" dataKey="views" name="Visualizações" stroke="var(--brand-700)" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="cartAdds" name="Carrinhos" stroke="var(--neutral-500)" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="unitsSold" name="Unidades" stroke="var(--neutral-900)" strokeWidth={2} strokeDasharray="4 3" dot={false} /></LineChart></ResponsiveContainer></div></figure> : <p className="admin-empty-copy">Ainda não há uma série de comportamento neste período.</p>}
        </section>

        <section className="panel-card management-table-card intelligence-wide-table">
          <ManagementSectionHeader title="Produtos com maior intenção" description="Visitas e ações comerciais por produto." />
          {data.topProducts.length ? <div className="management-table-wrap"><table className="data-table admin-data-table ui-table-stack intelligence-table"><thead><tr><th scope="col">Produto</th><th scope="col" className="ui-num">Visitas</th><th scope="col" className="ui-num">Favoritos</th><th scope="col" className="ui-num">Carrinho</th><th scope="col" className="ui-num">Intenção</th><th scope="col" className="ui-num">Vendas</th></tr></thead><tbody>{data.topProducts.map((row) => <tr key={row.productId}><td data-label="Produto">{row.name}</td><td data-label="Visitas" className="ui-num">{count(row.views)}</td><td data-label="Favoritos" className="ui-num">{count(row.favorites)}</td><td data-label="Carrinho" className="ui-num">{count(row.cartAdds)}</td><td data-label="Intenção" className="ui-num">{percent(row.cartAdds, row.views)}</td><td data-label="Vendas" className="ui-num">{count(row.unitsSold)}</td></tr>)}</tbody></table></div> : <p className="admin-empty-copy">Ainda não há sinais agregados no período.</p>}
        </section>

        <div className="management-two-columns intelligence-panel-grid">
          <section className="panel-card management-table-card">
            <ManagementSectionHeader title="Buscas e oportunidades" description="Termos que indicam lacunas ou baixa relevância." />
            {data.searches.length ? <div className="management-table-wrap"><table className="data-table admin-data-table ui-table-stack intelligence-table"><thead><tr><th scope="col">Busca</th><th scope="col" className="ui-num">Total</th><th scope="col" className="ui-num">Sem resultado</th><th scope="col" className="ui-num">Cliques</th><th scope="col">Oportunidade</th></tr></thead><tbody>{data.searches.map((row) => <tr key={row.query}><td data-label="Busca">{row.query}</td><td data-label="Total" className="ui-num">{count(row.searches)}</td><td data-label="Sem resultado" className="ui-num">{count(row.noResults)}</td><td data-label="Cliques" className="ui-num">{count(row.clicks)}</td><td data-label="Oportunidade"><StatusLabel tone={row.noResults > 0 || row.clicks < row.searches * 0.25 ? "warning" : "success"}>{row.noResults > 0 ? "Catálogo" : row.clicks < row.searches * 0.25 ? "Relevância" : "Atendida"}</StatusLabel></td></tr>)}</tbody></table></div> : <p className="admin-empty-copy">Nenhuma busca consentida foi agregada no período.</p>}
          </section>
          <section className="panel-card management-table-card">
            <ManagementSectionHeader title="Desempenho por origem" description="Eficiência das superfícies de recomendação." />
            {data.sources.length ? <div className="management-table-wrap"><table className="data-table admin-data-table ui-table-stack intelligence-table"><thead><tr><th scope="col">Origem</th><th scope="col" className="ui-num">Impressões</th><th scope="col" className="ui-num">Cliques</th><th scope="col" className="ui-num">CTR</th></tr></thead><tbody>{data.sources.map((row) => <tr key={row.source}><td data-label="Origem">{row.source}</td><td data-label="Impressões" className="ui-num">{count(row.impressions)}</td><td data-label="Cliques" className="ui-num">{count(row.clicks)}</td><td data-label="CTR" className="ui-num">{percent(row.clicks, row.impressions, 2)}</td></tr>)}</tbody></table></div> : <p className="admin-empty-copy">Sem impressões de recomendação no período.</p>}
          </section>
        </div>
      </> : null}
    </section>
  );
}
