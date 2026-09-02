"use client";

import {
  Eye,
  Heart,
  LoaderCircle,
  MousePointerClick,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  WalletCards
} from "lucide-react";
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
  ManagementEmptyState,
  ManagementMetricCard,
  ManagementPageHeader,
  ManagementSectionHeader
} from "@/components/management-ui";

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
        actions={<div className="management-header-filter">
          <label>Período<select value={days} onChange={(event) => setDays(Number(event.target.value))} disabled={loading}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option></select></label>
          <button className="secondary-button icon-button" type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar inteligência da loja"><RefreshCw className={loading ? "spin" : ""} aria-hidden="true" /></button>
        </div>}
      />

      {loading ? <div className="panel-loading"><LoaderCircle className="spin" aria-hidden="true" /> Consolidando indicadores…</div> : null}
      {error ? <ManagementEmptyState icon={Sparkles} title="Insights indisponíveis" description={error} action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Tentar novamente</button>} /> : null}
      {data && !data.enabled ? <ManagementEmptyState icon={Sparkles} title="Recurso pausado" description="A coleta de insights está desativada pela configuração do sistema." /> : null}

      {data?.enabled && !loading ? <>
        {data.demo ? <p className="admin-feedback" role="status">Ambiente de demonstração: nenhum comportamento real de clientes é exibido.</p> : null}
        <div className="management-metric-grid intelligence-metrics">
          <ManagementMetricCard icon={Eye} label="Visualizações" value={count(data.overview.views)} detail="Páginas de produto vistas" />
          <ManagementMetricCard icon={Heart} label="Favoritos" value={count(data.overview.favorites)} detail={percent(data.overview.favorites, data.overview.views) + " das visualizações"} />
          <ManagementMetricCard icon={ShoppingBag} label="Adições ao carrinho" value={count(data.overview.cartAdds)} detail={percent(data.overview.cartAdds, data.overview.views) + " de intenção"} />
          <ManagementMetricCard icon={MousePointerClick} label="Cliques em recomendações" value={count(data.overview.recommendationClicks)} detail="Interações consentidas" />
          <ManagementMetricCard icon={WalletCards} label="Unidades válidas" value={count(data.overview.unitsSold)} detail="Somente pedidos aprovados" />
          <ManagementMetricCard icon={Sparkles} label="Receita validada" value={money.format(Number(data.overview.revenue ?? 0))} detail="Receita dos pedidos aprovados" />
        </div>

        <section className="panel-card management-chart-card">
          <ManagementSectionHeader title="Jornada de intenção" description="Visualizações, carrinhos e unidades vendidas ao longo do período." />
          {chart.length ? <div className="management-chart" role="img" aria-label="Evolução das interações da loja"><ResponsiveContainer><LineChart data={chart} margin={{ left: 0, right: 8, top: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e7e3df" vertical={false} /><XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} /><YAxis fontSize={11} tickLine={false} axisLine={false} /><Tooltip /><Legend /><Line type="monotone" dataKey="views" name="Visualizações" stroke="var(--brand-800)" strokeWidth={2.5} dot={false} /><Line type="monotone" dataKey="cartAdds" name="Carrinhos" stroke="#b45309" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="unitsSold" name="Unidades" stroke="#15803d" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div> : <p className="admin-empty-copy">Ainda não há uma série de comportamento neste período.</p>}
        </section>

        <section className="panel-card management-table-card intelligence-wide-table">
          <ManagementSectionHeader title="Produtos com maior intenção" description="Visitas e ações comerciais por produto." />
          {data.topProducts.length ? <div className="admin-table-wrap"><table className="data-table admin-data-table intelligence-table"><thead><tr><th>Produto</th><th>Visitas</th><th>Favoritos</th><th>Carrinho</th><th>Intenção</th><th>Vendas</th></tr></thead><tbody>{data.topProducts.map((row) => <tr key={row.productId}><td data-label="Produto">{row.name}</td><td data-label="Visitas">{count(row.views)}</td><td data-label="Favoritos">{count(row.favorites)}</td><td data-label="Carrinho">{count(row.cartAdds)}</td><td data-label="Intenção">{percent(row.cartAdds, row.views)}</td><td data-label="Vendas">{count(row.unitsSold)}</td></tr>)}</tbody></table></div> : <p className="admin-empty-copy">Ainda não há sinais agregados no período.</p>}
        </section>

        <div className="management-two-columns intelligence-panel-grid">
          <section className="panel-card management-table-card">
            <ManagementSectionHeader title="Buscas e oportunidades" description="Termos que indicam lacunas ou baixa relevância." />
            {data.searches.length ? <div className="admin-table-wrap"><table className="data-table admin-data-table intelligence-table"><thead><tr><th>Busca</th><th>Total</th><th>Sem resultado</th><th>Cliques</th><th>Oportunidade</th></tr></thead><tbody>{data.searches.map((row) => <tr key={row.query}><td data-label="Busca">{row.query}</td><td data-label="Total">{count(row.searches)}</td><td data-label="Sem resultado">{count(row.noResults)}</td><td data-label="Cliques">{count(row.clicks)}</td><td data-label="Oportunidade"><span className={`status ${row.noResults > 0 || row.clicks < row.searches * 0.25 ? "orange" : "green"}`}>{row.noResults > 0 ? "Catálogo" : row.clicks < row.searches * 0.25 ? "Relevância" : "Atendida"}</span></td></tr>)}</tbody></table></div> : <p className="admin-empty-copy">Nenhuma busca consentida foi agregada no período.</p>}
          </section>
          <section className="panel-card management-table-card">
            <ManagementSectionHeader title="Desempenho por origem" description="Eficiência das superfícies de recomendação." />
            {data.sources.length ? <div className="admin-table-wrap"><table className="data-table admin-data-table intelligence-table"><thead><tr><th>Origem</th><th>Impressões</th><th>Cliques</th><th>CTR</th></tr></thead><tbody>{data.sources.map((row) => <tr key={row.source}><td data-label="Origem">{row.source}</td><td data-label="Impressões">{count(row.impressions)}</td><td data-label="Cliques">{count(row.clicks)}</td><td data-label="CTR">{percent(row.clicks, row.impressions, 2)}</td></tr>)}</tbody></table></div> : <p className="admin-empty-copy">Sem impressões de recomendação no período.</p>}
          </section>
        </div>
      </> : null}
    </section>
  );
}
