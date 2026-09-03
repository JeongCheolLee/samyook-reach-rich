// 환차손익 계산 — 순수 함수 (KIS 런타임 의존 없음, 테스트 가능)
//
// 원화 기준 손익을 세 갈래로 나눈다:
//   주가 손익 = (보유 평가 USD − 보유 매입 USD) × 현재환율
//   환차손익  = Σ 정산 완료 매수 lot [ USD × (현재환율 − 적용환율) ]
//   수수료    = Σ 국내수수료(원)
//
// 데이터 출처(KIS):
//   - lot     : 해외주식 일별거래내역 CTOS4001R output1 (매수 1건 = lot 1개, erlm_exrt = 적용환율)
//   - 보유    : 해외주식 잔고 TTTS3012R output1 (frcr_pchs_amt1 매입 USD, ovrs_stck_evlu_amt 평가 USD)
//   - 현재환율: 매수가능금액 TTTS3007R output.exrt (KIS 고시환율)
//
// 주의
//   - 결제 전(오늘 체결) 매수는 erlm_exrt=0, tr_amt=0으로 온다 → "정산 대기"로 표시만 하고 환차익 0 취급.
//   - 보유 매입 USD(frcr_pchs_amt1)에는 미정산 lot의 USD도 포함되므로 usdCost × avgRate로 계산하면
//     환차손익이 과대 계산된다. 반드시 정산 lot별로 합산한다.
//   - 달러 예수금의 환전 원가는 API로 알 수 없어 환차익 계산에서 제외(현재환율로만 평가).
//   - 매도 lot이 있으면(v1 범위 밖) 매수 lot 가중평균을 현재 보유 매입 USD에 그대로 적용하는 근사다.
//     FIFO로 확장할 땐 매도 수량만큼 오래된 매수 lot을 소진하도록 이 파일만 고치면 된다.

export interface FxLot {
  /** 거래일 YYYYMMDD */
  tradeDate: string;
  /** 결제일 YYYYMMDD */
  settleDate: string;
  symbol: string;
  name: string;
  side: "buy" | "sell";
  quantity: number;
  /** 체결단가 (USD) */
  price: number;
  /** 거래금액 (USD) */
  usd: number;
  /** 거래금액 (KRW, 수수료 제외). 미정산이면 0 */
  krw: number;
  /** 국내수수료 (KRW) */
  fee: number;
  /** 적용(등록)환율. 미정산(결제 전) 건은 0 */
  rate: number;
}

export interface FxHolding {
  /** 매입금액 (USD) */
  usdCost: number;
  /** 평가금액 (USD) */
  usdValue: number;
}

export interface FxBreakdown {
  /** 계산에 쓴 현재환율 (KIS 고시환율) */
  rateNow: number;
  /** 정산 완료 매수의 USD 가중평균 적용환율 = Σtr_amt / Σtr_frcr_amt2 */
  avgRate: number;
  /** (rateNow − avgRate) / avgRate × 100 */
  rateChangePct: number;
  /** 정산 완료 매수 USD 합계 */
  usdSettled: number;
  /** 정산 완료 매수 KRW 합계 (수수료 제외) */
  krwSettled: number;
  /** 현재 보유 매입 USD (미정산 포함) */
  usdCost: number;
  /** 현재 보유 평가 USD */
  usdValue: number;
  /** 주가 손익 (KRW, 반올림) */
  stockGain: number;
  /** 환차손익 (KRW, 반올림) */
  fxGain: number;
  /** 수수료 합계 (KRW, 반올림, 양수) */
  fees: number;
  /** stockGain + fxGain − fees */
  total: number;
  /** 정산 완료 매수 lot (오래된 → 최신) */
  settledLots: FxLot[];
  /** 정산 대기 매수 lot (오래된 → 최신) */
  pendingLots: FxLot[];
}

type KisTransactionRow = Record<string, string | undefined>;

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0);
}

/** CTOS4001R output1 행 → FxLot. 매수/매도 코드가 아닌 행(있다면)은 버린다. */
export function parseTransactionLots(
  rows: KisTransactionRow[] | null | undefined
): FxLot[] {
  if (!rows) return [];
  const lots: FxLot[] = [];
  for (const r of rows) {
    // sll_buy_dvsn_cd: "02" 매수, "01" 매도
    if (r.sll_buy_dvsn_cd !== "01" && r.sll_buy_dvsn_cd !== "02") continue;
    lots.push({
      tradeDate: r.trad_dt ?? "",
      settleDate: r.sttl_dt ?? "",
      symbol: r.pdno ?? "",
      name: r.ovrs_item_name ?? "",
      side: r.sll_buy_dvsn_cd === "01" ? "sell" : "buy",
      quantity: num(r.ccld_qty),
      price: num(r.ft_ccld_unpr2),
      usd: num(r.tr_frcr_amt2),
      krw: num(r.tr_amt),
      fee: num(r.dmst_wcrc_fee),
      rate: num(r.erlm_exrt),
    });
  }
  return lots.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

/** lot 하나의 환차손익 (KRW). 미정산 lot은 0. */
export function lotFxGain(lot: FxLot, rateNow: number): number {
  if (lot.rate <= 0 || lot.usd <= 0) return 0;
  return lot.usd * (rateNow - lot.rate);
}

/**
 * 환차손익 3분해.
 * 정산 완료 매수 lot이 없거나 현재환율이 0이면 null (카드 숨김 / 안내 문구용).
 */
export function computeFxBreakdown({
  lots,
  holdings,
  rateNow,
}: {
  lots: FxLot[];
  holdings: FxHolding[];
  rateNow: number;
}): FxBreakdown | null {
  if (!(rateNow > 0)) return null;

  const buys = lots.filter((l) => l.side === "buy");
  const settledLots = buys.filter((l) => l.rate > 0);
  const pendingLots = buys.filter((l) => l.rate <= 0);
  if (settledLots.length === 0) return null;

  const usdSettled = sum(settledLots, (l) => l.usd);
  const krwSettled = sum(settledLots, (l) => l.krw);
  if (!(usdSettled > 0)) return null;

  const avgRate = krwSettled / usdSettled;
  const rateChangePct = ((rateNow - avgRate) / avgRate) * 100;

  // 환차손익은 lot별 합산 (= usdSettled × (rateNow − avgRate)와 동치)
  const fxGain = Math.round(sum(settledLots, (l) => lotFxGain(l, rateNow)));

  const usdCost = sum(holdings, (h) => h.usdCost);
  const usdValue = sum(holdings, (h) => h.usdValue);
  const stockGain = Math.round((usdValue - usdCost) * rateNow);

  // 수수료는 매수·매도·미정산 가리지 않고 전부 (미정산은 0으로 온다)
  const fees = Math.round(sum(lots, (l) => l.fee));

  return {
    rateNow,
    avgRate,
    rateChangePct,
    usdSettled,
    krwSettled,
    usdCost,
    usdValue,
    stockGain,
    fxGain,
    fees,
    total: stockGain + fxGain - fees,
    settledLots,
    pendingLots,
  };
}

// 주가 영향(±) × 환율 영향(±) 4조합별 한 줄 멘트 — page.tsx의 STOCK_COMMENT_TIERS 톤.
// 서버에서 1회 선택해 props로 내려야 한다 (클라이언트에서 뽑으면 하이드레이션 불일치).
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

export function getFxComment(stockGain: number, fxGain: number): string {
  const key = `${stockGain >= 0 ? "p" : "n"}${
    fxGain >= 0 ? "p" : "n"
  }` as keyof typeof FX_COMMENTS;
  const messages = FX_COMMENTS[key];
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * 원화 손익 4분해. 합계가 페이지의 총자산 − 총납입금과 정확히 일치하도록,
 * 설명 가능한 세 항목(주가·환율·수수료)을 뺀 나머지를 "그 외"로 둔다.
 * 그 외 = 달러 예수금 환산손익 + 결제 전 매수분 + 반올림 잔차.
 */
export function fxOtherGain(fx: FxBreakdown, total: number): number {
  return total - fx.stockGain - fx.fxGain + fx.fees;
}
