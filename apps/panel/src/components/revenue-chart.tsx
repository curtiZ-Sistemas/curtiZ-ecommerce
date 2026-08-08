"use client";

import {
  CartesianGrid,
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
    <div style={{ width: "100%", height: 300 }} aria-label="Gráfico de faturamento">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee7e4" />
          <XAxis dataKey="date" fontSize={11} />
          <YAxis fontSize={11} tickFormatter={(value: number) => compactCurrency.format(value)} />
          <Tooltip formatter={(value) => compactCurrency.format(Number(value))} />
          <Line
            type="monotone"
            dataKey="gross"
            stroke="#7e1c13"
            strokeWidth={3}
            dot={false}
            name="Bruto"
          />
          <Line
            type="monotone"
            dataKey="net"
            stroke="#cf6853"
            strokeWidth={2}
            dot={false}
            name="Líquido"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
