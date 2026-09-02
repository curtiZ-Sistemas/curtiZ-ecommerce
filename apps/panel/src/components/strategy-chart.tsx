"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export type StrategyPoint = {
  date: string;
  gross: number;
  profit: number;
};

const compactCurrency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1
});

export function StrategyChart({ data }: { data: StrategyPoint[] }) {
  if (!data.length) return <p className="admin-empty-copy">Sem vendas no período selecionado.</p>;

  return (
    <div className="management-chart" role="img" aria-label="Evolução do faturamento bruto e do lucro estimado">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="strategyGross" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand-700)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--brand-700)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e3df" vertical={false} />
          <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis
            width={72}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => compactCurrency.format(value)}
          />
          <Tooltip formatter={(value) => compactCurrency.format(Number(value))} />
          <Legend />
          <Area
            type="monotone"
            dataKey="gross"
            name="Faturamento bruto"
            stroke="var(--brand-800)"
            strokeWidth={2.5}
            fill="url(#strategyGross)"
          />
          <Area
            type="monotone"
            dataKey="profit"
            name="Lucro estimado"
            stroke="#15803d"
            strokeWidth={2}
            fill="transparent"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
