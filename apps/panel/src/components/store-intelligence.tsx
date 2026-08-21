"use client";

import { LoaderCircle, RefreshCw, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
};
const number = (value: number) => Number(value ?? 0).toLocaleString("pt-BR");

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
      setError(
        loadError instanceof Error ? loadError.message : "Não foi possível carregar os insights."
      );
    } finally {
      setLoading(false);
    }
  }, [days]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="store-intelligence">
      <header className="intelligence-panel-heading">
        <div>
          <span>Descoberta e comportamento</span>
          <h1>Inteligência da loja</h1>
          <p>
            Sinais agregados e consentidos para decisões de catálogo. Compras são contabilizadas
            somente após aprovação do pedido.
          </p>
        </div>
        <label>
          Período
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
        </label>
      </header>
      {loading ? (
        <div className="panel-loading">
          <LoaderCircle className="spin" />
          Consolidando indicadores…
        </div>
      ) : error ? (
        <div className="admin-empty-state">
          <Sparkles />
          <h2>Insights indisponíveis</h2>
          <p>{error}</p>
          <button className="secondary-button" onClick={() => void load()}>
            <RefreshCw />
            Tentar novamente
          </button>
        </div>
      ) : data && !data.enabled ? (
        <div className="admin-empty-state">
          <Sparkles />
          <h2>Recurso pausado</h2>
          <p>A feature flag de insights está desativada.</p>
        </div>
      ) : data ? (
        <>
          <div className="metric-grid intelligence-metrics">
            <article>
              <span>Visualizações</span>
              <strong>{number(data.overview.views)}</strong>
            </article>
            <article>
              <span>Favoritos</span>
              <strong>{number(data.overview.favorites)}</strong>
            </article>
            <article>
              <span>Adições ao carrinho</span>
              <strong>{number(data.overview.cartAdds)}</strong>
            </article>
            <article>
              <span>Cliques em recomendações</span>
              <strong>{number(data.overview.recommendationClicks)}</strong>
            </article>
            <article>
              <span>Unidades válidas</span>
              <strong>{number(data.overview.unitsSold)}</strong>
            </article>
            <article>
              <span>Receita validada</span>
              <strong>
                {Number(data.overview.revenue ?? 0).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL"
                })}
              </strong>
            </article>
          </div>
          <div className="intelligence-panel-grid">
            <section className="panel-card">
              <h2>
                <Sparkles />
                Produtos com maior intenção
              </h2>
              {data.topProducts.length ? (
                <div className="admin-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Visitas</th>
                        <th>Favoritos</th>
                        <th>Carrinho</th>
                        <th>Intenção</th>
                        <th>Vendas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topProducts.map((row) => (
                        <tr key={row.productId}>
                          <td>{row.name}</td>
                          <td>{number(row.views)}</td>
                          <td>{number(row.favorites)}</td>
                          <td>{number(row.cartAdds)}</td>
                          <td>
                            {row.views
                              ? `${((row.cartAdds / row.views) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
                              : "—"}
                          </td>
                          <td>{number(row.unitsSold)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="panel-muted">Ainda não há sinais agregados no período.</p>
              )}
            </section>
            <section className="panel-card">
              <h2>
                <Search />
                Buscas e oportunidades
              </h2>
              {data.searches.length ? (
                <div className="admin-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Busca</th>
                        <th>Total</th>
                        <th>Sem resultado</th>
                        <th>Cliques</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.searches.map((row) => (
                        <tr key={row.query}>
                          <td>{row.query}</td>
                          <td>{number(row.searches)}</td>
                          <td>{number(row.noResults)}</td>
                          <td>{number(row.clicks)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="panel-muted">Nenhuma busca consentida agregada no período.</p>
              )}
            </section>
            <section className="panel-card">
              <h2>
                <Sparkles />
                Desempenho por origem
              </h2>
              {data.sources.length ? (
                <div className="admin-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Origem</th>
                        <th>Impressões</th>
                        <th>Cliques</th>
                        <th>CTR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sources.map((row) => (
                        <tr key={row.source}>
                          <td>{row.source}</td>
                          <td>{number(row.impressions)}</td>
                          <td>{number(row.clicks)}</td>
                          <td>
                            {row.impressions
                              ? `${((row.clicks / row.impressions) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="panel-muted">Sem impressões de recomendação no período.</p>
              )}
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
}
