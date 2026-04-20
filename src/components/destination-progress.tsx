"use client";

import { useState, useEffect } from "react";
import { destinationTiers, getCurrentTier } from "@/lib/mock-data";

function formatKRW(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount) + "원";
}

export function DestinationProgress({
  perPersonValue,
  memberCount,
}: {
  perPersonValue: number;
  memberCount: number;
}) {
  const { current, next } = getCurrentTier(perPersonValue);

  const tiers = destinationTiers.slice(1);
  // 달성한 티어 (0="손절"은 미달성 취급)
  const currentAchievedIdx =
    current.threshold > 0
      ? tiers.findIndex((t) => t.destination === current.destination)
      : -1;
  // 초기 뷰는 다음 목표 티어. 모두 달성했으면 마지막 티어 유지
  const nextTargetIdx = next
    ? tiers.findIndex((t) => t.destination === next.destination)
    : Math.max(0, currentAchievedIdx);

  const [viewIdx, setViewIdx] = useState(nextTargetIdx);
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const viewTier = tiers[viewIdx];
  const tierValue = viewTier.threshold * 10_000;
  const isComplete = perPersonValue >= tierValue;

  const targetPercent = isComplete
    ? 100
    : tierValue > 0
    ? Math.min(100, Math.max(0, Math.round((perPersonValue / tierValue) * 100)))
    : 0;

  const totalAmount = viewTier.threshold * 10_000 * memberCount;

  // viewIdx 바뀔 때마다: transition 끄고 0%로 리셋 → 2프레임 후 transition 켜고 채우기
  useEffect(() => {
    setIsAnimating(false);
    setAnimatedPercent(0);

    // 2프레임 대기해야 브라우저가 0% 상태를 실제로 렌더함
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        setIsAnimating(true);
        setAnimatedPercent(targetPercent);
      });
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, [viewIdx, targetPercent]);

  return (
    <section className="rounded-xl border border-card-border bg-card p-6 h-[340px] sm:h-[320px] flex flex-col">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-4">
        <h2 className="font-semibold text-lg">삼육, 올해엔 어디로 갈 것인가? 아니 가긴 가나..?</h2>
        <span className="text-sm">
          총 <strong className="text-foreground">{formatKRW(perPersonValue * memberCount)}</strong>
        </span>
      </div>

      {/* 보고 있는 티어 */}
      <div className="flex-1 flex flex-col justify-center">
        <div className="text-center mb-3">
          <div className="text-xs text-muted mb-0.5">
            {isComplete ? "달성!" : `${viewIdx + 1}단계 · ${targetPercent}%`}
          </div>
          <div
            className={`text-3xl font-bold ${
              isComplete
                ? "text-accent"
                : targetPercent > 0
                ? "text-foreground"
                : "text-muted"
            }`}
          >
            {viewTier.destination}
          </div>
          <div className="text-sm text-muted mt-0.5">{viewTier.comment}</div>
        </div>

        {/* 프로그레스 바 */}
        <div className="w-full bg-gray-100 rounded-full h-5 overflow-hidden mb-2">
          <div
            className={`h-full rounded-full bg-accent ${
              isAnimating
                ? "transition-all duration-700 ease-out"
                : "transition-none"
            }`}
            style={{ width: `${animatedPercent}%` }}
          />
        </div>

        {/* 금액 라벨 */}
        <div className="flex items-center justify-between text-xs text-muted">
          <span>0원</span>
          {!isComplete && (
            <span className="font-medium text-accent">
              {formatKRW((tierValue - perPersonValue) * memberCount)} 남음
            </span>
          )}
          <span className="text-right">
            <span className="block font-medium text-foreground">
              {viewIdx < tiers.length - 1
                ? tiers[viewIdx + 1].destination
                : "드림 트립"}
            </span>
            <span>{formatKRW(totalAmount)}</span>
          </span>
        </div>
      </div>

      {/* 스텝 인디케이터 */}
      <div className="flex items-end justify-center gap-1.5 flex-wrap pt-4">
        {tiers.map((tier, i) => {
          const tierVal = tier.threshold * 10_000;
          const isDone = perPersonValue >= tierVal;
          const isNow = i === currentAchievedIdx;
          const isViewing = i === viewIdx;

          return (
            <div key={tier.threshold} className="flex flex-col items-center">
              {isNow && (
                <svg
                  width="10"
                  height="6"
                  viewBox="0 0 10 6"
                  className="text-accent mb-1"
                >
                  <path d="M5 6L0 0h10z" fill="currentColor" />
                </svg>
              )}
              <button
                onClick={() => setViewIdx(i)}
                className={`relative group rounded-full transition-all w-3 h-3 sm:w-3.5 sm:h-3.5 ${
                  isViewing ? "ring-2 ring-accent ring-offset-1" : ""
                } ${
                  isDone
                    ? "bg-accent"
                    : "bg-gray-200 hover:bg-gray-300"
                }`}
              >
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-foreground text-background text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  {tier.destination}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
