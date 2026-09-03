"use client";

import { useState } from "react";
import { StockChart } from "./stock-chart";
import { FxChart, type FxChartPoint, type FxQuote } from "./fx-chart";

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

export interface FxChartItem {
  /** 원/달러 30일 일봉 (오래된 → 최신) */
  data: FxChartPoint[];
  /** 결제 완료 매수의 USD 가중평균 적용환율 */
  avgRate: number;
  /** KIS 고시환율 */
  rateNow: number;
  quote: FxQuote | null;
}

/** 원/달러 탭의 키. 종목코드와 겹치지 않는 값 */
const FX_TAB = "__fx__";

function EmptyChart() {
  return (
    <section className="rounded-xl border border-card-border bg-card p-6 text-center text-muted text-sm">
      차트 데이터가 없습니다
    </section>
  );
}

/**
 * 30일 차트 탭. 종목별 주가 차트에 원/달러 환율 차트를 한 탭으로 붙인다.
 * 탭이 하나뿐이면 탭 줄 없이 차트만 렌더 (1종목 + 환율 없음 = 0.4.0과 동일).
 */
export function HoldingsChart({
  items,
  fx,
}: {
  items: HoldingsChartItem[];
  /** 환율 차트. null이면 탭을 추가하지 않는다 */
  fx?: FxChartItem | null;
}) {
  const hasFx = !!fx && fx.data.length > 0;
  const tabs = [
    ...items.map((item) => ({ key: item.symbol, label: item.symbol, title: item.name })),
    ...(hasFx ? [{ key: FX_TAB, label: "원/달러", title: "원/달러 환율" }] : []),
  ];
  const [selected, setSelected] = useState(tabs[0]?.key ?? "");

  if (tabs.length === 0) return <EmptyChart />;

  // 선택된 탭이 목록에서 사라졌으면(리렌더로 items가 바뀐 경우) 첫 탭으로
  const active = tabs.find((t) => t.key === selected) ?? tabs[0];

  let chart;
  if (active.key === FX_TAB && fx) {
    chart = (
      <FxChart
        data={fx.data}
        avgRate={fx.avgRate}
        rateNow={fx.rateNow}
        quote={fx.quote}
      />
    );
  } else {
    const holding = items.find((i) => i.symbol === active.key);
    chart =
      holding && holding.data.length > 0 ? (
        <StockChart
          key={holding.symbol}
          data={holding.data}
          symbol={holding.symbol}
          avgPrice={holding.avgPrice}
        />
      ) : (
        <EmptyChart />
      );
  }

  if (tabs.length === 1) return chart;

  const panelId = "holdings-chart-panel";

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="차트 종목 선택"
        className="flex flex-wrap gap-2"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`holdings-chart-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={panelId}
              title={tab.title}
              onClick={() => setSelected(tab.key)}
              // min-h-11 = 44px: 모바일 터치 영역 기준 (0.4.0 디자인 원칙)
              className={`min-h-11 px-4 rounded-full border text-sm font-semibold font-mono transition-colors ${
                isActive
                  ? "bg-foreground text-card border-foreground"
                  : "bg-card text-muted border-card-border hover:text-foreground hover:border-muted"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`holdings-chart-tab-${active.key}`}
      >
        {chart}
      </div>
    </div>
  );
}
