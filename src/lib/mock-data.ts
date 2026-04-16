// 한투 API 연동 전 목업 데이터
// API 키 발급 후 실제 데이터로 교체 예정

export interface Holding {
  symbol: string;
  name: string;
  quantity: number;
  avgPrice: number; // 평균 매수가 (USD)
  currentPrice: number; // 현재가 (USD)
  currency: "USD";
}

export interface PortfolioSummary {
  totalInvested: number; // 총 투자금 (KRW)
  currentValue: number; // 현재 평가금 (KRW)
  returnRate: number; // 수익률 (%)
  returnAmount: number; // 수익금 (KRW)
  memberCount: number;
  monthlyContribution: number; // 1인당 월 납입금
  months: number; // 진행 개월 수
}

export interface Member {
  name: string;
  icon: string;
  totalContributed: number;
}

export interface DestinationTier {
  threshold: number; // 인당 평가금 기준 (만원)
  destination: string;
  comment: string;
}

export const destinationTiers: DestinationTier[] = [
  { threshold: 0, destination: "손절 (해산)", comment: "없던 일로 하자" },
  { threshold: 5, destination: "발산역", comment: "빅맥세트 각" },
  { threshold: 10, destination: "노량진 수산시장", comment: "회 한 점이라도" },
  { threshold: 20, destination: "가평", comment: "닭갈비+펜션 당일치기" },
  { threshold: 30, destination: "강원도", comment: "1박에 서핑 한 번" },
  { threshold: 40, destination: "부산", comment: "KTX 타고 돼지국밥 원정" },
  { threshold: 60, destination: "제주도", comment: "드디어 비행기 탑승" },
  { threshold: 80, destination: "오사카/후쿠오카", comment: "첫 해외, 라멘 순례" },
  { threshold: 100, destination: "방콕/다낭", comment: "동남아 풀빌라" },
  { threshold: 120, destination: "도쿄/교토", comment: "여유로운 일본 3박" },
  { threshold: 140, destination: "발리/싱가포르", comment: "리조트급 동남아" },
  { threshold: 160, destination: "대만+일본/홍콩", comment: "아시아 두 도시" },
  { threshold: 180, destination: "하와이/괌", comment: "태평양 건너기" },
  { threshold: 200, destination: "유럽", comment: "파리/런던, 드림 트립" },
];

export const members: Member[] = [
  { name: "민우", icon: "🐻", totalContributed: 150_000 },
  { name: "성윤", icon: "🐯", totalContributed: 150_000 },
  { name: "재홍", icon: "🦊", totalContributed: 150_000 },
  { name: "철현", icon: "🐺", totalContributed: 150_000 },
  { name: "상운", icon: "🦁", totalContributed: 150_000 },
  { name: "우재", icon: "🐧", totalContributed: 150_000 },
  { name: "준형", icon: "🐶", totalContributed: 150_000 },
  { name: "세운", icon: "🐱", totalContributed: 150_000 },
];

export const holdings: Holding[] = [
  {
    symbol: "DJT",
    name: "Trump Media & Technology",
    quantity: 10,
    avgPrice: 32.5,
    currentPrice: 28.15,
    currency: "USD",
  },
];

export const portfolio: PortfolioSummary = {
  totalInvested: 1_200_000, // 8명 × 5만원 × 3개월
  currentValue: 1_304_000,
  returnRate: 8.67,
  returnAmount: 104_000,
  memberCount: 8,
  monthlyContribution: 50_000,
  months: 3,
};

/** 인당 평가금(원)으로 현재 여행지 티어를 구한다 */
export function getCurrentTier(perPersonValue: number): {
  current: DestinationTier;
  next: DestinationTier | null;
  progress: number; // 현재 티어 내 진행률 0~100
} {
  const valueInMan = perPersonValue / 10_000; // 원 → 만원

  let currentIdx = 0;
  for (let i = destinationTiers.length - 1; i >= 0; i--) {
    if (valueInMan >= destinationTiers[i].threshold) {
      currentIdx = i;
      break;
    }
  }

  const current = destinationTiers[currentIdx];
  const next =
    currentIdx < destinationTiers.length - 1
      ? destinationTiers[currentIdx + 1]
      : null;

  let progress = 100;
  if (next) {
    const range = next.threshold - current.threshold;
    progress = Math.round(((valueInMan - current.threshold) / range) * 100);
  }

  return { current, next, progress };
}
