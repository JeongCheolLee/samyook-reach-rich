// 보유 종목 카드 (서버 컴포넌트, 프레젠테이션 전용)
// 데이터 페치·랜덤 문구 선택은 page.tsx에서 하고 props로 내려준다.

export interface HoldingData {
  symbol: string;
  name: string;
  /** 잔고 API의 거래소 코드 (NASD / NYSE / AMEX) */
  exchange: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  totalValue: number;
  totalCost: number;
  returnRate: number;
}

export interface PriceDetail {
  open: number;
  high: number;
  low: number;
  prevClose: number;
  change: number;
  changeRate: number;
  volume: number;
}

function formatUSD(amount: number) {
  return (
    "$" +
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  );
}

function formatPercent(value: number) {
  const sign = value >= 0 ? "+" : "";
  return sign + value.toFixed(2) + "%";
}

export function HoldingCard({
  holding: h,
  priceDetail,
  comment,
  weightPercent,
}: {
  holding: HoldingData;
  priceDetail: PriceDetail | null;
  /** 수익률 구간별 한 마디 (서버에서 1회 랜덤 선택) */
  comment: string;
  /** 종목이 2개 이상일 때만 넘겨서 헤더에 비중 칩을 표시 */
  weightPercent?: number;
}) {
  const positive = h.returnRate >= 0;
  const dayPositive = priceDetail ? priceDetail.change >= 0 : true;

  return (
    // grow: 세로 스택 컨테이너 안에서 남는 높이를 채움 (1종목일 때 옆 멤버 섹션과 높이 맞춤)
    <section className="grow rounded-xl border border-card-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold">{h.symbol}</h2>
            {weightPercent !== undefined && (
              <span className="rounded-full border border-card-border px-2 py-0.5 text-xs font-mono text-muted tabular-nums">
                비중 {weightPercent.toFixed(0)}%
              </span>
            )}
          </div>
          <span className="text-sm text-muted">{h.name}</span>
        </div>
        <div className="text-right">
          <div
            className={`text-2xl font-bold ${
              dayPositive ? "text-positive" : "text-negative"
            }`}
          >
            {formatUSD(h.currentPrice)}
          </div>
          {priceDetail && (
            <div
              className={`text-sm font-mono ${
                dayPositive ? "text-positive" : "text-negative"
              }`}
            >
              {dayPositive ? "▲" : "▼"}{" "}
              {formatUSD(Math.abs(priceDetail.change))}{" "}
              ({dayPositive ? "+" : "-"}{Math.abs(priceDetail.changeRate).toFixed(2)}%)
            </div>
          )}
        </div>
      </div>

      {priceDetail && (
        <div className="flex items-center gap-3 mb-4 py-2 px-3 rounded-lg bg-card-border/30">
          <div className="flex-1 text-center">
            <div className="text-[10px] text-muted">시가</div>
            <div className="text-xs font-mono font-medium">{priceDetail.open > 0 ? formatUSD(priceDetail.open) : <span className="text-muted">—</span>}</div>
          </div>
          <div className="w-px h-6 bg-card-border" />
          <div className="flex-1 text-center">
            <div className="text-[10px] text-muted">고가</div>
            <div className={`text-xs font-mono font-medium ${priceDetail.high > 0 ? "text-positive" : "text-muted"}`}>{priceDetail.high > 0 ? formatUSD(priceDetail.high) : "—"}</div>
          </div>
          <div className="w-px h-6 bg-card-border" />
          <div className="flex-1 text-center">
            <div className="text-[10px] text-muted">저가</div>
            <div className={`text-xs font-mono font-medium ${priceDetail.low > 0 ? "text-negative" : "text-muted"}`}>{priceDetail.low > 0 ? formatUSD(priceDetail.low) : "—"}</div>
          </div>
          <div className="w-px h-6 bg-card-border" />
          <div className="flex-1 text-center">
            <div className="text-[10px] text-muted">거래량</div>
            <div className="text-xs font-mono font-medium">{new Intl.NumberFormat("en-US", { notation: "compact" }).format(priceDetail.volume)}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-xs text-muted mb-0.5">평균 매수가</div>
          <div className="font-mono font-semibold">
            {formatUSD(h.avgPrice)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted mb-0.5">보유 수량</div>
          <div className="font-semibold">{h.quantity}주</div>
        </div>
        <div>
          <div className="text-xs text-muted mb-0.5">매수금</div>
          <div className="font-mono font-semibold">
            {formatUSD(h.totalCost)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted mb-0.5">평가금</div>
          <div
            className={`font-mono font-semibold ${
              positive ? "text-positive" : "text-negative"
            }`}
          >
            {formatUSD(h.totalValue)}
            <span className="text-xs text-muted ml-1">
              ({positive ? "+" : ""}
              {formatUSD(h.totalValue - h.totalCost)})
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted">내 수익률</span>
        <span
          className={`text-lg font-bold font-mono ${
            positive ? "text-positive" : "text-negative"
          }`}
        >
          {formatPercent(h.returnRate)}
        </span>
      </div>

      <div
        className={`text-sm text-center py-2 px-3 rounded-lg ${
          positive ? "bg-positive-bg" : "bg-negative-bg"
        }`}
      >
        {comment}
      </div>
    </section>
  );
}
