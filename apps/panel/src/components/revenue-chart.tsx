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

const data = [
  { date: "18 Jul", gross: 420, net: 360 },
  { date: "19 Jul", gross: 780, net: 650 },
  { date: "20 Jul", gross: 1_140, net: 930 },
  { date: "21 Jul", gross: 1_020, net: 850 },
  { date: "22 Jul", gross: 1_470, net: 1_250 },
  { date: "23 Jul", gross: 1_320, net: 1_120 },
  { date: "24 Jul", gross: 1_840, net: 1_560 }
];

export function RevenueChart() {
  return (
    <div style={{ width: "100%", height: 300 }} aria-label="Gráfico de faturamento demonstrativo">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee7e4" />
          <XAxis dataKey="date" fontSize={11} />
          <YAxis fontSize={11} />
          <Tooltip />
          <Line type="monotone" dataKey="gross" stroke="#7e1c13" strokeWidth={3} dot={false} name="Bruto" />
          <Line type="monotone" dataKey="net" stroke="#cf6853" strokeWidth={2} dot={false} name="Líquido" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
