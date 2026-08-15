import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ChartMarketRow {
  timestamp: string;
  bestSell: number | null;
  bestBuy: number | null;
}

function formatIsk(value: number): string {
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: value < 10_000 ? 2 : 0 }).format(value)} ISK`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function HistoryChart({ rows }: { rows: ChartMarketRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis
          dataKey="timestamp"
          tickFormatter={(value: string) => new Intl.DateTimeFormat("de-DE", { hour: "2-digit" }).format(new Date(value))}
          minTickGap={42}
          tick={{ fill: "var(--muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={["auto", "auto"]}
          tickFormatter={(value: number) => new Intl.NumberFormat("de-DE", { notation: "compact" }).format(value)}
          width={62}
          tick={{ fill: "var(--muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          labelFormatter={(value) => formatTime(String(value))}
          formatter={(value, name) => [formatIsk(Number(value)), name === "bestSell" ? "Best Sell" : "Best Buy"]}
          contentStyle={{
            background: "var(--surface-raised)",
            border: "1px solid var(--line-strong)",
            borderRadius: 0,
            color: "var(--text)",
          }}
        />
        <Line type="monotone" dataKey="bestSell" name="Best Sell" stroke="var(--amber)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="bestBuy" name="Best Buy" stroke="var(--green)" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
