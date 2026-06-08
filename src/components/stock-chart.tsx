"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface ChartPoint {
  date: string;
  price: number;
}

function formatUSD(value: number) {
  return "$" + value.toFixed(2);
}

export function StockChart({
  data,
  symbol,
  avgPrice,
}: {
  data: ChartPoint[];
  symbol: string;
  avgPrice?: number;
}) {
  if (data.length === 0) return null;

  const first = data[0].price;
  const last = data[data.length - 1].price;
  const change = last - first;
  const changePercent = (change / first) * 100;
  const isPositive = change >= 0;

  const color = isPositive ? "#16a34a" : "#dc2626";

  // 평단(평균 매수가)이 있으면 가로선으로 표시. 가격 범위 밖이어도 보이도록 Y축 도메인을 넓힌다.
  const hasAvg = typeof avgPrice === "number" && avgPrice > 0;
  const prices = data.map((d) => d.price);
  const dataMin = Math.min(...prices);
  const dataMax = Math.max(...prices);
  const yMin = (hasAvg ? Math.min(dataMin, avgPrice!) : dataMin) - 2;
  const yMax = (hasAvg ? Math.max(dataMax, avgPrice!) : dataMax) + 2;

  return (
    <section className="rounded-xl border border-card-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">{symbol} 최근 30일</h2>
        <div className="text-right">
          <span
            className={`text-sm font-semibold ${
              isPositive ? "text-positive" : "text-negative"
            }`}
          >
            {isPositive ? "+" : ""}
            {formatUSD(change)} ({isPositive ? "+" : ""}
            {changePercent.toFixed(2)}%)
          </span>
        </div>
      </div>
      <div className="h-48 sm:h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[yMin, yMax]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              tickFormatter={(v: number) => `$${v}`}
              width={50}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value) => [formatUSD(Number(value)), "가격"]}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={color}
              strokeWidth={2}
              fill="url(#priceGradient)"
            />
            {hasAvg && (
              <ReferenceLine
                y={avgPrice}
                stroke="#64748b"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: `평단 ${formatUSD(avgPrice!)}`,
                  position: "insideTopLeft",
                  fontSize: 11,
                  fill: "#64748b",
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
