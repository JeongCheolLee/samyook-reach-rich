import type { FxBreakdown as FxBreakdownData, FxLot } from "@/lib/fx";
import { lotFxGain } from "@/lib/fx";
import { FxChart, type FxChartPoint } from "@/components/fx-chart";

/** FX 일봉 output1에서 온 현재/전일대비 (시장환율 기준) */
export interface FxQuote {
  rate: number;
  prevClose: number;
  change: number;
  changeRate: number;
}

function formatKRW(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount) + "원";
}

/** 양수엔 +, 음수는 Intl이 붙이는 "-" 그대로 (사이트 전체 표기와 동일) */
function formatSignedKRW(amount: number) {
  return (amount > 0 ? "+" : "") + formatKRW(amount);
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

function formatUSD(amount: number) {
  return (
    "$" +
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  );
}

function formatSignedUSD(amount: number) {
  return (amount > 0 ? "+" : "") + formatUSD(amount);
}

/** YYYYMMDD → MM/DD */
function formatDate(yyyymmdd: string) {
  return yyyymmdd.length >= 8
    ? `${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6, 8)}`
    : yyyymmdd;
}

function signClass(value: number) {
  return value >= 0 ? "text-positive" : "text-negative";
}

// 주가손익(±) × 환차손익(±) 4조합별 한 줄 멘트 — STOCK_COMMENT_TIERS 톤
const FX_COMMENTS = {
  pp: [
    "환율이 우릴 부자로 만든다 이건 못 참지",
    "주식도 달러도 우리 편... 이럴 때가 제일 무섭다",
    "나스닥도 킹달러도 순풍 유럽 직항 알아보자",
  ],
  pn: [
    "주식은 벌었는데 환율이 다 먹었다",
    "나스닥은 이겼는데 원화가 배신했다",
    "환율만 제자리였으면 치킨이 몇 마리냐",
  ],
  np: [
    "주식은 물렸는데 달러가 살렸다 킹달러 만세",
    "나스닥은 졌지만 환율로 방어 성공",
    "주가 빠진 만큼 환율이 메꿨다 이게 헤지다",
  ],
  nn: [
    "주식도 환율도 안 도와준다 존버각",
    "이중으로 맞았다 라면 끓일 시간",
    "나스닥 하락에 원화 강세 오늘은 차트 끄자",
  ],
} as const;

function getFxComment(stockGain: number, fxGain: number): string {
  const key = `${stockGain >= 0 ? "p" : "n"}${
    fxGain >= 0 ? "p" : "n"
  }` as keyof typeof FX_COMMENTS;
  const messages = FX_COMMENTS[key];
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * 환차손익 카드 — 원화 손익을 주가 손익 / 환차손익 / 수수료로 분해해서 보여준다.
 * 서버 컴포넌트. 차트만 클라이언트(FxChart).
 */
export function FxBreakdown({
  fx,
  chart,
  quote,
}: {
  fx: FxBreakdownData;
  /** 원/달러 30일 일봉 (오래된 → 최신). 비어 있으면 차트 생략 */
  chart: FxChartPoint[];
  /** 시장환율 전일 대비. null이면 등락 줄 생략 */
  quote: FxQuote | null;
}) {
  const totalUp = fx.total >= 0;
  const dayUp = quote ? quote.change >= 0 : null;
  const lots: FxLot[] = [...fx.settledLots, ...fx.pendingLots].sort((a, b) =>
    a.tradeDate.localeCompare(b.tradeDate)
  );
  const settledQty = fx.settledLots.reduce((s, l) => s + l.quantity, 0);
  const comment = getFxComment(fx.stockGain, fx.fxGain);

  return (
    <section className="rounded-xl border border-card-border bg-card p-6">
      {/* 헤더: 제목 + 현재 환율 블록 (주가 카드의 현재가·등락과 같은 문법) */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-semibold">환차손익</h2>
          <span className="text-sm text-muted">환율이 우릴 어디로</span>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-muted mb-0.5">현재 원/달러</div>
          <div
            className={`text-2xl font-bold font-mono ${
              dayUp === null
                ? "text-foreground"
                : dayUp
                ? "text-positive"
                : "text-negative"
            }`}
          >
            {formatRate(fx.rateNow)}
          </div>
          {quote && dayUp !== null && (
            <div
              className={`text-sm font-mono ${
                dayUp ? "text-positive" : "text-negative"
              }`}
            >
              {dayUp ? "▲" : "▼"} {Math.abs(quote.change).toFixed(1)} (
              {dayUp ? "+" : "-"}
              {Math.abs(quote.changeRate).toFixed(2)}%)
            </div>
          )}
        </div>
      </div>

      {/* 헤드라인: 환차손익 */}
      <div className="mb-4">
        <div
          className={`text-3xl font-bold tracking-tight ${signClass(fx.fxGain)}`}
        >
          {formatSignedKRW(fx.fxGain)}
        </div>
        <div className="text-sm text-muted mt-1">
          평균 적용환율{" "}
          <span className="font-mono text-foreground">{formatRate(fx.avgRate)}</span>
          {" → "}현재{" "}
          <span className="font-mono text-foreground">{formatRate(fx.rateNow)}</span>{" "}
          <span className="font-mono">
            ({fx.rateChangePct > 0 ? "+" : ""}
            {fx.rateChangePct.toFixed(1)}%)
          </span>
        </div>
      </div>

      {/* 3분해: 주가 손익 / 환차손익 / 수수료 → 합계 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
        <BreakdownItem
          label="주가 손익"
          value={fx.stockGain}
          hint={`${formatSignedUSD(fx.usdValue - fx.usdCost)} × ${formatRate(fx.rateNow)}`}
        />
        <BreakdownItem
          label="환차손익"
          value={fx.fxGain}
          hint={`${formatUSD(fx.usdSettled)} × (${formatRate(fx.rateNow)} − ${formatRate(fx.avgRate)})`}
        />
        <BreakdownItem
          label="수수료"
          value={-fx.fees}
          neutral
          hint={`매수 ${lots.length}건 국내수수료`}
        />
      </div>
      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-card-border/30 mb-4">
        <span className="text-sm text-muted">합계 (원화 손익)</span>
        <span className={`font-mono font-semibold ${signClass(fx.total)}`}>
          {formatSignedKRW(fx.total)}
        </span>
      </div>

      {/* 한 줄 멘트 */}
      <div
        className={`text-sm text-center py-2 px-3 rounded-lg mb-4 ${
          totalUp ? "bg-positive-bg" : "bg-negative-bg"
        }`}
      >
        {comment}
      </div>

      {/* 매수 내역 (접이식) */}
      <details className="group rounded-lg border border-card-border mb-4">
        <summary className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 px-3 py-2 text-sm list-none [&::-webkit-details-marker]:hidden">
          <span>
            매수 내역 {lots.length}건
            {fx.pendingLots.length > 0 && (
              <span className="text-muted"> · 정산 대기 {fx.pendingLots.length}건</span>
            )}
          </span>
          <span
            aria-hidden="true"
            className="text-muted transition-transform group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        {/* 표가 375px보다 넓어지면 표 안에서만 가로 스크롤 (페이지는 안 밀림) */}
        <div className="overflow-x-auto border-t border-card-border">
          <table className="w-full text-xs tabular-nums whitespace-nowrap">
            <thead>
              <tr className="text-muted">
                <th className="px-3 py-2 text-left font-medium">날짜</th>
                <th className="px-2 py-2 text-right font-medium">수량</th>
                <th className="px-2 py-2 text-right font-medium">체결가</th>
                <th className="px-2 py-2 text-right font-medium">적용환율</th>
                <th className="px-2 py-2 text-right font-medium">원화금액</th>
                <th className="px-3 py-2 text-right font-medium">현재환율 대비</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {lots.map((lot) => {
                const pending = lot.rate <= 0;
                const gain = Math.round(lotFxGain(lot, fx.rateNow));
                return (
                  <tr
                    key={`${lot.tradeDate}-${lot.symbol}-${lot.price}-${lot.quantity}`}
                    className="border-t border-card-border"
                  >
                    <td className="px-3 py-2 font-mono">
                      {formatDate(lot.tradeDate)}
                      {pending && (
                        <span className="ml-1.5 rounded-full border border-card-border px-1.5 py-px text-[10px] text-muted font-sans align-middle">
                          정산 대기
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{lot.quantity}주</td>
                    <td className="px-2 py-2 text-right font-mono">{formatUSD(lot.price)}</td>
                    <td className="px-2 py-2 text-right font-mono">
                      {pending ? <span className="text-muted">—</span> : formatRate(lot.rate)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {pending ? <span className="text-muted">—</span> : formatKRW(lot.krw)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        pending ? "text-muted" : signClass(gain)
                      }`}
                    >
                      {pending ? "—" : formatSignedKRW(gain)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-card-border font-semibold">
                <td className="px-3 py-2">정산 완료 합계</td>
                <td className="px-2 py-2 text-right font-mono">{settledQty}주</td>
                <td className="px-2 py-2 text-right font-mono">{formatUSD(fx.usdSettled)}</td>
                <td className="px-2 py-2 text-right font-mono">{formatRate(fx.avgRate)}</td>
                <td className="px-2 py-2 text-right font-mono">{formatKRW(fx.krwSettled)}</td>
                <td className={`px-3 py-2 text-right font-mono ${signClass(fx.fxGain)}`}>
                  {formatSignedKRW(fx.fxGain)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>

      {/* 원/달러 30일 차트 + 평균 적용환율 점선 */}
      {chart.length > 0 && (
        <div className="border-t border-card-border pt-4 mb-3">
          <FxChart data={chart} avgRate={fx.avgRate} rateNow={fx.rateNow} />
        </div>
      )}

      <p className="text-xs text-muted leading-relaxed">
        환차손익은 KIS 매수 시 적용환율 기준이며 달러 예수금은 제외했어요. 큰 숫자는 KIS
        고시환율, 등락과 차트는 시장환율(원/달러 KMB)이라 소폭 다를 수 있어요.
      </p>
    </section>
  );
}

function BreakdownItem({
  label,
  value,
  hint,
  neutral,
}: {
  label: string;
  value: number;
  hint?: string;
  /** 수수료처럼 항상 비용인 항목은 색을 입히지 않는다 (초록/빨강 과용 방지) */
  neutral?: boolean;
}) {
  return (
    <div className="rounded-lg border border-card-border p-3">
      <div className="text-xs text-muted mb-0.5">{label}</div>
      <div
        className={`font-mono font-semibold ${
          neutral ? "text-foreground" : signClass(value)
        }`}
      >
        {formatSignedKRW(value)}
      </div>
      {hint ? (
        <div className="text-xs text-muted mt-0.5 font-mono break-words">{hint}</div>
      ) : null}
    </div>
  );
}
