"use client";

import { useState } from "react";
import { StockChart } from "./stock-chart";

export interface ChartPoint {
  date: string;
  price: number;
}

export interface HoldingsChartItem {
  symbol: string;
  name: string;
  /** 30일 일봉 (오래된 날짜부터). 조회 실패 시 빈 배열 */
  data: ChartPoint[];
  avgPrice?: number;
}

function EmptyChart() {
  return (
    <section className="rounded-xl border border-card-border bg-card p-6 text-center text-muted text-sm">
      차트 데이터가 없습니다
    </section>
  );
}

/** 종목별 30일 차트. 1종목이면 탭 없이 차트만, 2종목 이상이면 종목코드 pill 탭으로 전환. */
export function HoldingsChart({ items }: { items: HoldingsChartItem[] }) {
  const [selected, setSelected] = useState(items[0]?.symbol ?? "");

  if (items.length === 0) return <EmptyChart />;

  // 선택된 종목이 목록에서 사라졌으면(리렌더로 items가 바뀐 경우) 첫 종목으로
  const active = items.find((i) => i.symbol === selected) ?? items[0];
  const chart =
    active.data.length > 0 ? (
      <StockChart
        key={active.symbol}
        data={active.data}
        symbol={active.symbol}
        avgPrice={active.avgPrice}
      />
    ) : (
      <EmptyChart />
    );

  if (items.length === 1) return chart;

  const panelId = "holdings-chart-panel";

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="차트 종목 선택"
        className="flex flex-wrap gap-2"
      >
        {items.map((item) => {
          const isActive = item.symbol === active.symbol;
          return (
            <button
              key={item.symbol}
              type="button"
              role="tab"
              id={`holdings-chart-tab-${item.symbol}`}
              aria-selected={isActive}
              aria-controls={panelId}
              title={item.name}
              onClick={() => setSelected(item.symbol)}
              // min-h-11 = 44px: 모바일 터치 영역 기준 (0.4.0 디자인 원칙)
              className={`min-h-11 px-4 rounded-full border text-sm font-semibold font-mono transition-colors ${
                isActive
                  ? "bg-foreground text-card border-foreground"
                  : "bg-card text-muted border-card-border hover:text-foreground hover:border-muted"
              }`}
            >
              {item.symbol}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`holdings-chart-tab-${active.symbol}`}
      >
        {chart}
      </div>
    </div>
  );
}
