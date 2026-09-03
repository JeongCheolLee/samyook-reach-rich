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

export interface FxChartPoint {
  /** MM/DD */
  date: string;
  /** 원/달러 종가 */
  rate: number;
}

/** FX 일봉 output1에서 온 현재/전일대비 (시장환율 기준) */
export interface FxQuote {
  rate: number;
  prevClose: number;
  change: number;
  changeRate: number;
}

function formatRate(value: number) {
  return (
    "₩" +
    new Intl.NumberFormat("ko-KR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value)
  );
}

/**
 * 원/달러 30일 차트 + 우리 평균 매수환율 가로 점선 (주가 차트의 평단선과 같은 문법).
 * 차트 탭의 한 칸으로 렌더되므로 StockChart와 같은 카드 껍데기를 갖는다.
 */
export function FxChart({
  data,
  avgRate,
  rateNow,
  quote,
}: {
  data: FxChartPoint[];
  /** 결제 완료 매수의 USD 가중평균 적용환율 */
  avgRate: number;
  /** 계산에 쓴 현재 고시환율 */
  rateNow: number;
  /** 시장환율 전일 대비. null이면 등락 줄 생략 */
  quote?: FxQuote | null;
}) {
  if (data.length === 0) return null;

  // 헤더 숫자는 "30일 변화"가 아니라 "내 평균 매수환율 대비" — 패널의 환율 영향과 같은 기준
  const diff = rateNow - avgRate;
  const diffPercent = (diff / avgRate) * 100;
  // 달러를 들고 있으니 환율이 평단 위 = 우리에게 이득
  const aboveAvg = diff >= 0;
  const color = aboveAvg ? "#16a34a" : "#dc2626";
  const dayUp = quote ? quote.change >= 0 : null;

  // 평균 매수환율이 차트 범위 밖이어도 보이도록 Y축 범위에 포함시키고,
  // 깔끔한 단위(5·10·20·25·50…)로 감싸 눈금을 직접 준다 (끝 눈금만 튀는 것 방지).
  const rates = data.map((d) => d.rate);
  const lo = Math.min(...rates, avgRate);
  const hi = Math.max(...rates, avgRate);
  const span = Math.max(hi - lo, 1);
  const step = [5, 10, 20, 25, 50, 100, 200].find((s) => span / s <= 6) ?? 500;
  let yMin = Math.floor(lo / step) * step;
  let yMax = Math.ceil(hi / step) * step;
  // 선이 축 끝에 딱 붙지 않게 한 칸 여유
  if (lo - yMin < step * 0.15) yMin -= step;
  if (yMax - hi < step * 0.15) yMax += step;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax; v += step) ticks.push(v);

  return (
    <section className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <h2 className="font-semibold">원/달러 최근 30일</h2>
        <div className="sm:text-right">
          <span
            className={`font-mono text-sm font-semibold ${
              aboveAvg ? "text-positive" : "text-negative"
            }`}
          >
            평균 매수환율 대비 {aboveAvg ? "+" : ""}
            {diff.toFixed(1)} ({aboveAvg ? "+" : ""}
            {diffPercent.toFixed(2)}%)
          </span>
          {quote && dayUp !== null && (
            <div className="text-xs text-muted">
              오늘 {formatRate(quote.rate)}{" "}
              <span
                className={`font-mono ${dayUp ? "text-positive" : "text-negative"}`}
              >
                {dayUp ? "▲" : "▼"} {Math.abs(quote.change).toFixed(1)} (
                {dayUp ? "+" : "-"}
                {Math.abs(quote.changeRate).toFixed(2)}%)
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="h-48 sm:h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="fxRateGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#64748b" }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              domain={[yMin, yMax]}
              ticks={ticks}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickFormatter={(v: number) =>
                new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(v)
              }
              width={44}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value) => [formatRate(Number(value)), "원/달러"]}
            />
            <Area
              type="monotone"
              dataKey="rate"
              stroke={color}
              strokeWidth={2}
              fill="url(#fxRateGradient)"
            />
            <ReferenceLine
              y={avgRate}
              stroke="#64748b"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: `평균 매수환율 ${formatRate(avgRate)}`,
                position: "insideTopLeft",
                fontSize: 11,
                fill: "#64748b",
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
