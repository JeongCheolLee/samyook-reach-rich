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
 * 원/달러 30일 차트 + 우리 평균 적용환율 가로 점선 (주가 차트의 평단선과 같은 문법).
 * 환차손익 카드 안에서 렌더되는 하위 블록이라 자체 카드 테두리는 없다.
 */
export function FxChart({
  data,
  avgRate,
  rateNow,
}: {
  data: FxChartPoint[];
  /** 정산 완료 매수의 USD 가중평균 적용환율 */
  avgRate: number;
  /** 계산에 쓴 현재 고시환율 */
  rateNow: number;
}) {
  if (data.length === 0) return null;

  const first = data[0].rate;
  const last = data[data.length - 1].rate;
  const change = last - first;
  const changePercent = (change / first) * 100;
  // 달러를 들고 있으니 환율 상승 = 우리에게 이득
  const changeUp = change >= 0;

  // 면·선 색은 "현재환율이 우리 평균 적용환율 위인가"(= 환차익 중인가)로 정한다.
  const aboveAvg = rateNow >= avgRate;
  const color = aboveAvg ? "#16a34a" : "#dc2626";

  // 평균 적용환율이 차트 범위 밖이어도 보이도록 Y축 범위에 포함시키고,
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
    <div>
      <div className="flex items-center justify-between mb-3 gap-3">
        <h3 className="text-sm font-medium">원/달러 최근 30일</h3>
        <span
          className={`text-sm font-semibold font-mono ${
            changeUp ? "text-positive" : "text-negative"
          }`}
        >
          {changeUp ? "+" : ""}
          {change.toFixed(1)} ({changeUp ? "+" : ""}
          {changePercent.toFixed(2)}%)
        </span>
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
                value: `평균 환율 ${formatRate(avgRate)}`,
                position: "insideTopLeft",
                fontSize: 11,
                fill: "#64748b",
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
