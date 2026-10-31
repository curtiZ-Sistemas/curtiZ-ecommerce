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

export type RevenuePoint = {
  date: string;
  gross: number;
  net: number;
};

const compactCurrency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1
});

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  if (!data.some((point) => point.gross !== 0 || point.net !== 0)) {
    return <p className="admin-empty-copy">Sem vendas no período selecionado.</p>;
  }

  const first = data[0]?.date;
  const last = data[data.length - 1]?.date;

  return (
    <figure className="management-chart">
      <div
        className="management-chart-canvas"
        role="img"
        aria-label={`Gráfico de faturamento bruto e líquido por dia, de ${first} a ${last}.`}
      >
        <ResponsiveContainer>
          <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="date" tick={chartAxisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={16} />
            <YAxis width={72} tick={chartAxisTick} tickLine={false} axisLine={false} tickFormatter={(value: number) => compactCurrency.format(value)} />
            <Tooltip {...chartTooltipProps} formatter={(value) => compactCurrency.format(Number(value))} />
            <Legend wrapperStyle={chartLegendStyle} iconType="plainline" />
            <Line type="monotone" dataKey="gross" stroke="var(--brand-700)" strokeWidth={2} dot={false} name="Bruto" />
            <Line type="monotone" dataKey="net" stroke="var(--neutral-500)" strokeWidth={2} dot={false} name="Líquido" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
