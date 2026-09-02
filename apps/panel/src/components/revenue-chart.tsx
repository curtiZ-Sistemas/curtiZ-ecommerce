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
  if (data.length === 0) {
    return <p className="admin-empty-copy">Sem vendas no período selecionado.</p>;
  }

  return (
    <div className="management-chart" role="img" aria-label="Gráfico de faturamento bruto e líquido">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e3df" vertical={false} />
          <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis width={72} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value: number) => compactCurrency.format(value)} />
          <Tooltip formatter={(value) => compactCurrency.format(Number(value))} />
          <Legend />
          <Line
            type="monotone"
            dataKey="gross"
            stroke="var(--brand-800)"
            strokeWidth={3}
            dot={false}
            name="Bruto"
          />
          <Line
            type="monotone"
            dataKey="net"
            stroke="#c94336"
            strokeWidth={2}
            dot={false}
            name="Líquido"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
