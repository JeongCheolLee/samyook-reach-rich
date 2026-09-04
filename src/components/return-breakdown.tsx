"use client";

import { useState } from "react";
import type { FxBreakdown, FxLot } from "@/lib/fx";
import { lotFxGain } from "@/lib/fx";

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

function formatPercent(value: number) {
  return (value >= 0 ? "+" : "") + value.toFixed(2) + "%";
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

function impactSummary(total: number, fxGain: number) {
  const totalAmount = formatKRW(Math.abs(total));
  const fxAmount = formatKRW(Math.abs(fxGain));

  if (total < 0 && fxGain < 0) {
    return `전체 손실은 ${totalAmount}, 그중 ${fxAmount}이 환율 손실이에요`;
  }
  if (total >= 0 && fxGain >= 0) {
    return `전체 수익은 ${totalAmount}, 환율이 ${fxAmount}을 보탰어요`;
  }
  if (fxGain < 0) {
    return `전체 수익은 ${totalAmount}, 환율이 ${fxAmount}을 줄였어요`;
  }
  return `전체 손실은 ${totalAmount}, 환율이 ${fxAmount}을 만회했어요`;
}

const PANEL_ID = "return-breakdown-panel";

/**
 * 핵심 지표 3카드 + "수익률이 어디서 왔나" 펼침 패널.
 *
 * 0.5.0의 별도 환차손익 카드를 이 패널로 흡수했다. 헤드라인 숫자를 수익률 하나로 두고,
 * 패널의 4항목 합계가 총자산 − 총납입금과 정확히 일치하게 만드는 것이 이 컴포넌트의 요점.
 * (설명 가능한 3항목의 잔차를 "그 외"로 두는 계산은 lib/fx.ts의 fxOtherGain)
 */
export function ReturnBreakdown({
  contributed,
  asset,
  returnRate,
  total,
  assetTooltip,
  fx,
  other,
  comment,
  heldQty,
}: {
  contributed: number;
  asset: number;
  returnRate: number;
  /** 총자산 − 총납입금. 패널 4항목의 합과 일치한다 */
  total: number;
  assetTooltip: string[];
  /** 환율 분해 결과. null이면 카드 3개만 렌더하고 펼침 없음 */
  fx: FxBreakdown | null;
  /** 예수금·결제 대기 조정 (예수금 환산·결제 전 매수·반올림 잔차) */
  other: number;
  /** 서버에서 1회 선택한 한 줄 멘트 */
  comment: string;
  /** 보유 주식 총 수량 (결제 대기분 포함) */
  heldQty: number;
}) {
  const [open, setOpen] = useState(true);
  const positive = returnRate >= 0;
  const rateValue = `${formatPercent(returnRate)} (${formatSignedKRW(total)})`;
  const settledQty = fx?.settledLots.reduce((sum, lot) => sum + lot.quantity, 0) ?? 0;
  const pendingQty = fx?.pendingLots.reduce((sum, lot) => sum + lot.quantity, 0) ?? 0;
  // 막대 길이 기준 = 4항목 절댓값 중 최대 (가장 큰 항목이 100%)
  const scale = fx
    ? Math.max(
        Math.abs(fx.stockGain),
        Math.abs(fx.fxGain),
        fx.fees,
        Math.abs(other),
        1
      )
    : 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="총 납입금" value={formatKRW(contributed)} />
        <StatCard label="총 자산" value={formatKRW(asset)} tooltip={assetTooltip} />
        {fx ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={PANEL_ID}
            className={`relative flex min-h-11 flex-col items-start rounded-xl border bg-card p-4 text-left transition-colors ${
              open ? "border-foreground" : "border-card-border hover:border-muted"
            }`}
          >
            <span className="mb-1 text-xs text-muted">수익률</span>
            <span
              className={`text-lg font-semibold tracking-tight ${
                positive ? "text-positive" : "text-negative"
              }`}
            >
              {rateValue}
            </span>
            <span className="absolute right-4 top-4 inline-flex items-center gap-1 text-xs text-muted">
              환율 영향
              <span
                aria-hidden="true"
                className={`transition-transform ${open ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </span>
          </button>
        ) : (
          <StatCard
            label="수익률"
            value={rateValue}
            color={positive ? "positive" : "negative"}
          />
        )}
      </div>

      {fx && open && (
        <section
          id={PANEL_ID}
          className="flex flex-col gap-3 rounded-xl border border-card-border bg-card p-4 sm:px-6 sm:py-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{impactSummary(total, fx.fxGain)}</h2>
            <span className="hidden text-xs text-muted sm:inline">원화 환산 기준</span>
          </div>

          <RateStrip fx={fx} />

          <div className="flex flex-col">
            <BreakdownRow
              label="주가 변동"
              value={fx.stockGain}
              scale={scale}
              tone={fx.stockGain >= 0 ? "positive" : "negative"}
            />
            <BreakdownRow
              label="환율 변동"
              value={fx.fxGain}
              hint={`결제 완료 ${formatUSD(fx.usdSettled)} × 환율 ${
                fx.rateNow >= fx.avgRate ? "상승" : "하락"
              } ${new Intl.NumberFormat(
                "ko-KR",
                { maximumFractionDigits: 1 }
              ).format(Math.abs(fx.rateNow - fx.avgRate))}원`}
              scale={scale}
              tone={fx.fxGain >= 0 ? "positive" : "negative"}
            />
            <BreakdownRow
              label="매매 수수료"
              value={-fx.fees}
              hint={`매수 ${fx.settledLots.length + fx.pendingLots.length}건에 든 국내수수료`}
              scale={scale}
              tone="neutral"
            />
            <BreakdownRow
              label="예수금·결제 대기 조정"
              value={other}
              hint={otherHint(fx)}
              scale={scale}
              tone="faint"
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-card-border pt-2.5">
            <span className="text-sm text-muted">전체 평가손익</span>
            <span className={`font-mono font-semibold ${signClass(total)}`}>
              {formatSignedKRW(total)}
            </span>
          </div>

          <div
            className={`rounded-lg px-3 py-2 text-center text-sm ${
              positive ? "bg-positive-bg" : "bg-negative-bg"
            }`}
          >
            {comment}
          </div>

          <LotDetails fx={fx} heldQty={heldQty} />

          <p className="text-xs leading-relaxed text-muted">
            환율 손익은 결제가 완료된 {settledQty}주만 계산해요. 달러 예수금과 결제 대기{" "}
            {pendingQty}주는 &quot;예수금·결제 대기 조정&quot;에 포함돼요. 표시 환율은 KIS
            고시환율 기준이라 차트와 소폭 다를 수 있어요.
          </p>
        </section>
      )}
    </div>
  );
}

/** 예수금·결제 대기 조정에 실제로 무엇이 들어있는지 상황에 맞게 설명 */
function otherHint(fx: FxBreakdown): string {
  const parts = ["달러 예수금 환산"];
  if (fx.pendingLots.length > 0) {
    const first = fx.pendingLots[0];
    parts.push(
      `${formatDate(first.tradeDate)} 매수분은 ${formatDate(first.settleDate)} 환율 확정`
    );
  }
  return parts.join(" · ");
}

/** 평균 매수환율 → 현재 환율 한 줄 (환율 이야기의 헤드라인) */
function RateStrip({ fx }: { fx: FxBreakdown }) {
  const lower = fx.rateNow < fx.avgRate;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-card-border/30 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-xs text-muted">평균 매수환율 → 현재환율</span>
      <span className="font-mono font-semibold">
        {formatRate(fx.avgRate)}
        <span className="mx-1.5 font-normal text-muted" aria-hidden="true">
          →
        </span>
        {formatRate(fx.rateNow)}
      </span>
      <span className="text-xs">
        평균 매수환율보다 현재 환율이{" "}
        <span
          className={`font-mono font-semibold ${
            lower ? "text-negative" : "text-positive"
          }`}
        >
          {Math.abs(fx.rateChangePct).toFixed(1)}%
        </span>{" "}
        {lower ? "낮아요" : "높아요"}
      </span>
    </div>
  );
}

const TONE_BAR = {
  positive: "bg-positive",
  negative: "bg-negative",
  neutral: "bg-muted",
  faint: "bg-muted/40",
} as const;

/** 한 항목 = 라벨 + 크기 막대 + 금액. 데스크톱은 한 줄, 모바일은 막대가 아래로 */
function BreakdownRow({
  label,
  value,
  hint,
  scale,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  /** 막대 길이 기준 (4항목 절댓값 중 최대) */
  scale: number;
  tone: keyof typeof TONE_BAR;
}) {
  const width = scale > 0 ? (Math.abs(value) / scale) * 100 : 0;
  const bar = (
    <div className="h-2">
      <div
        className={`h-2 min-w-[4px] rounded-r ${TONE_BAR[tone]}`}
        style={{ width: `${width.toFixed(1)}%` }}
      />
    </div>
  );

  return (
    <div className="border-t border-card-border py-2.5 first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-sm sm:w-40">{label}</span>
        <div className="hidden flex-1 sm:block">{bar}</div>
        <span
          className={`font-mono text-sm font-semibold tabular-nums ${
            tone === "neutral" || tone === "faint" ? "" : signClass(value)
          }`}
        >
          {formatSignedKRW(value)}
        </span>
      </div>
      <div className="mt-1.5 sm:hidden">{bar}</div>
      {hint ? <div className="mt-1 text-xs text-muted sm:pl-40">{hint}</div> : null}
    </div>
  );
}

/** 매수별 적용환율 표 (접이식). 결제 대기 건은 환율 확정 전이라 손익 0으로 둔다 */
function LotDetails({ fx, heldQty }: { fx: FxBreakdown; heldQty: number }) {
  const lots: FxLot[] = [...fx.settledLots, ...fx.pendingLots].sort((a, b) =>
    a.tradeDate.localeCompare(b.tradeDate)
  );
  const settledQty = fx.settledLots.reduce((s, l) => s + l.quantity, 0);
  const pendingQty = fx.pendingLots.reduce((s, l) => s + l.quantity, 0);

  return (
    <details className="group rounded-lg border border-card-border">
      <summary className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 px-3 py-2 text-sm list-none [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col sm:block">
          <span>매수별 환율 손익 보기</span>
          <span className="text-xs text-muted sm:text-sm">
            <span className="hidden sm:inline"> · </span>매수 {lots.length}건
            {fx.pendingLots.length > 0 && ` · 결제 대기 ${fx.pendingLots.length}건`}
          </span>
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
                      <span className="ml-1.5 rounded-full border border-card-border px-1.5 py-px align-middle font-sans text-[10px] text-muted">
                        결제 대기
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right font-mono">{lot.quantity}주</td>
                  <td className="px-2 py-2 text-right font-mono">
                    {formatUSD(lot.price)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono">
                    {pending ? (
                      <span className="text-muted">
                        {formatDate(lot.settleDate)} 확정
                      </span>
                    ) : (
                      formatRate(lot.rate)
                    )}
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
              <td className="px-3 py-2">결제 완료 합계</td>
              <td className="px-2 py-2 text-right font-mono">{settledQty}주</td>
              <td className="px-2 py-2 text-right font-mono">
                {formatUSD(fx.usdSettled)}
              </td>
              <td className="px-2 py-2 text-right font-mono">{formatRate(fx.avgRate)}</td>
              <td className="px-2 py-2 text-right font-mono">
                {formatKRW(fx.krwSettled)}
              </td>
              <td className={`px-3 py-2 text-right font-mono ${signClass(fx.fxGain)}`}>
                {formatSignedKRW(fx.fxGain)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="border-t border-card-border px-3 py-2 text-xs leading-relaxed text-muted">
        보유 {heldQty}주 중 환율이 확정된 {settledQty}주 기준이에요.
        {pendingQty > 0 && fx.pendingLots[0] && (
          <>
            {" "}
            결제 대기 {pendingQty}주는 매수 대금은 이미 나갔고,{" "}
            {formatDate(fx.pendingLots[0].settleDate)}에 적용환율이 확정돼요.
          </>
        )}
      </p>
    </details>
  );
}

function StatCard({
  label,
  value,
  color,
  tooltip,
}: {
  label: string;
  value: string;
  color?: "positive" | "negative";
  tooltip?: string[];
}) {
  return (
    <div className="group relative rounded-xl border border-card-border bg-card p-4">
      <div className="mb-1 text-xs text-muted">{label}</div>
      <div
        className={`text-lg font-semibold tracking-tight ${
          color === "positive"
            ? "text-positive"
            : color === "negative"
            ? "text-negative"
            : "text-foreground"
        }`}
      >
        {value}
      </div>
      {tooltip && (
        <div className="pointer-events-none absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-card-border bg-card p-3 opacity-0 shadow-lg transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          {tooltip.map((line, i) => (
            <div key={i} className="font-mono text-xs whitespace-nowrap text-muted">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
