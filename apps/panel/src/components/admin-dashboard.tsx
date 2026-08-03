"use client";

import {
  Boxes,
  CircleAlert,
  Image,
  LoaderCircle,
  MessageSquareMore,
  PackageCheck,
  ShoppingBag,
  Tags,
  Users
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type DashboardData = {
  metrics: {
    grossRevenueInCents: number;
    orders: number;
    products: number;
    lowStock: number;
    customers: number;
    representatives: number;
    kits: number;
    pendingReviews: number;
    publishedBanners: number;
    publishedCampaigns: number;
  };
  recentOrders: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
  warnings: string[];
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

const text = (value: unknown) => (typeof value === "string" ? value : "—");
const number = (value: unknown) => (typeof value === "number" ? value : Number(value) || 0);

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/dashboard", { cache: "no-store" });
      const result = (await response.json()) as DashboardData & { message?: string };
      if (!response.ok) throw new Error(result.message);
      setData(result);
    } catch {
      setError("Não foi possível carregar o painel agora.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" aria-hidden="true" />
        Carregando indicadores
      </div>
    );
  }
  if (!data || error) {
    return (
      <div className="admin-empty-state" role="alert">
        <CircleAlert aria-hidden="true" />
        <h2>Indicadores indisponíveis</h2>
        <p>{error}</p>
        <button className="secondary-button" type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </div>
    );
  }

  const metrics = [
    ["Vendas", money.format(data.metrics.grossRevenueInCents / 100), ShoppingBag],
    ["Pedidos", data.metrics.orders.toLocaleString("pt-BR"), PackageCheck],
    ["Produtos", data.metrics.products.toLocaleString("pt-BR"), Boxes],
    ["Estoque baixo", data.metrics.lowStock.toLocaleString("pt-BR"), CircleAlert],
    ["Clientes", data.metrics.customers.toLocaleString("pt-BR"), Users],
    ["Representantes", data.metrics.representatives.toLocaleString("pt-BR"), Users],
    ["Kits", data.metrics.kits.toLocaleString("pt-BR"), Tags],
    [
      "Avaliações pendentes",
      data.metrics.pendingReviews.toLocaleString("pt-BR"),
      MessageSquareMore
    ],
    ["Banners publicados", data.metrics.publishedBanners.toLocaleString("pt-BR"), Image],
    ["Campanhas publicadas", data.metrics.publishedCampaigns.toLocaleString("pt-BR"), Tags]
  ] as const;

  return (
    <div className="admin-dashboard">
      <div className="admin-metric-grid">
        {metrics.map(([label, value, Icon]) => (
          <article className="admin-metric" key={label}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      {data.warnings.length > 0 && (
        <p className="admin-inline-warning" role="status">
          Dados parciais: {data.warnings.join(", ")}.
        </p>
      )}
      <div className="admin-dashboard-columns">
        <section className="panel-card">
          <h2>Pedidos recentes</h2>
          {data.recentOrders.length === 0 ? (
            <p className="admin-empty-copy">Nenhum pedido registrado.</p>
          ) : (
            <div className="admin-compact-list">
              {data.recentOrders.map((order) => (
                <div key={text(order.id)}>
                  <span>
                    <strong>{text(order.public_code)}</strong>
                    <small>
                      {text(order.status)} · {text(order.payment_status)}
                    </small>
                  </span>
                  <span>
                    <strong>{money.format(number(order.grand_total))}</strong>
                    <small>{date.format(new Date(text(order.created_at)))}</small>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel-card">
          <h2>Atividades recentes</h2>
          {data.activities.length === 0 ? (
            <p className="admin-empty-copy">Nenhuma atividade auditável registrada.</p>
          ) : (
            <div className="admin-compact-list">
              {data.activities.map((activity) => (
                <div key={text(activity.id)}>
                  <span>
                    <strong>{text(activity.action)}</strong>
                    <small>{text(activity.entity_type)}</small>
                  </span>
                  <time>{date.format(new Date(text(activity.created_at)))}</time>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
