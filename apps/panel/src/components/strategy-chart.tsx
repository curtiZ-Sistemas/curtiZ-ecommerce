"use client";

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
import { chartAxisTick, chartLegendStyle, chartTooltipProps } from "@/components/management-ui";

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

  const first = data[0]?.date;
  const last = data[data.length - 1]?.date;

  return (
    <figure className="management-chart">
      <div
        className="management-chart-canvas"
        role="img"
        aria-label={`Evolução do faturamento bruto e do lucro estimado por dia, de ${first} a ${last}.`}
      >
        <ResponsiveContainer>
          <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="date" tick={chartAxisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={16} />
            <YAxis
              width={72}
              tick={chartAxisTick}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => compactCurrency.format(value)}
            />
            <Tooltip {...chartTooltipProps} formatter={(value) => compactCurrency.format(Number(value))} />
            <Legend wrapperStyle={chartLegendStyle} iconType="plainline" />
            <Line type="monotone" dataKey="gross" name="Faturamento bruto" stroke="var(--brand-700)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="profit" name="Lucro estimado" stroke="var(--neutral-500)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
