// 한국투자증권 Open API 클라이언트 (실전투자)

import { Redis } from "@upstash/redis";

const BASE_URL = process.env.KIS_BASE_URL!;
const APP_KEY = process.env.KIS_APP_KEY!;
const APP_SECRET = process.env.KIS_APP_SECRET!;
const CANO = process.env.KIS_ACCOUNT_NO!;
const ACNT_PRDT_CD = process.env.KIS_ACCOUNT_PRDT!;

const TOKEN_KEY = "kis:access_token";
const TOKEN_LOCK_KEY = "kis:access_token:lock";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

type StoredToken = { token: string; expiresAt: number };

// 메모리 캐시 (웜 스타트 시 재사용)
let cachedToken: StoredToken | null = null;
// 동일 인스턴스 내 동시 요청 중복 발급 방지
let tokenPromise: Promise<string> | null = null;

/** Access Token 발급
 *  우선순위: 메모리 → Redis → KIS 재발급
 *  Redis 분산 락으로 여러 서버리스 인스턴스의 동시 재발급을 방지 (KIS 1분 1회 제한 회피)
 */
async function getAccessToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    cachedToken = null;
  } else {
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
      return cachedToken.token;
    }

    const stored = await redis.get<StoredToken>(TOKEN_KEY);
    if (stored && Date.now() < stored.expiresAt) {
      cachedToken = stored;
      return stored.token;
    }
  }

  if (tokenPromise) return tokenPromise;

  tokenPromise = acquireLockAndFetch();
  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
}

/** 캐시된 토큰 강제 무효화 (401 복구용) */
async function invalidateToken(): Promise<void> {
  cachedToken = null;
  try {
    await redis.del(TOKEN_KEY);
  } catch {
    // Redis 장애여도 메모리 캐시는 비웠으니 다음 호출에서 재발급 시도
  }
}

/** Redis를 주기적으로 폴링해서 다른 인스턴스가 발급한 토큰을 기다림 */
async function waitForSharedToken(
  attempts: number,
  intervalMs: number
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const stored = await redis.get<StoredToken>(TOKEN_KEY);
    if (stored && Date.now() < stored.expiresAt) {
      cachedToken = stored;
      return stored.token;
    }
  }
  return null;
}

async function acquireLockAndFetch(): Promise<string> {
  // SET NX EX 60 → 60초 락
  const gotLock = await redis.set(TOKEN_LOCK_KEY, "1", { nx: true, ex: 60 });

  if (!gotLock) {
    // 다른 인스턴스가 발급 중 → 최대 10초까지 Redis 폴링
    const shared = await waitForSharedToken(20, 500);
    if (shared) return shared;
    // 끝내 못 받으면 KIS 호출 (남의 락은 건드리지 않음)
    return fetchToken();
  }

  try {
    return await fetchToken();
  } finally {
    await redis.del(TOKEN_LOCK_KEY);
  }
}

async function fetchToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: APP_KEY,
      appsecret: APP_SECRET,
    }),
  });

  const text = await res.text();
  let data: {
    access_token?: string;
    expires_in?: number;
    error_code?: string;
    error_description?: string;
  } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  // KIS "1분당 1건 발급" 레이트리밋 (EGW00133) → Redis 폴링으로 대기
  if (
    data?.error_code === "EGW00133" ||
    /EGW00133/.test(text) ||
    /1분당 1건/.test(text)
  ) {
    const shared = await waitForSharedToken(20, 500);
    if (shared) return shared;
    throw new Error(`Token 발급 레이트리밋 (EGW00133): ${text}`);
  }

  if (!res.ok || !data?.access_token || !data?.expires_in) {
    throw new Error(`Token 발급 실패: ${res.status} ${text}`);
  }

  const expiresAt = Date.now() + (data.expires_in - 3600) * 1000;
  cachedToken = { token: data.access_token, expiresAt };

  const ttlSeconds = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
  await redis.set(TOKEN_KEY, cachedToken, { ex: ttlSeconds });

  return cachedToken.token;
}

/** KIS가 돌려주는 "토큰이 죽었다" 계열 에러 판별 */
function isTokenError(status: number, text: string): boolean {
  if (status === 401) return true;
  // EGW00121: 토큰 만료, EGW00123: 토큰 무효 (등 0012x 계열)
  if (/EGW0012\d/.test(text)) return true;
  if (/access.?token/i.test(text) && /(expired|invalid|만료|무효)/i.test(text))
    return true;
  return false;
}

/** 공통 GET 호출 헬퍼 */
async function kisGet(
  path: string,
  trId: string,
  params: Record<string, string>,
  retried = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const token = await getAccessToken(retried);
  const url = new URL(path, BASE_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      "Content-Type": "application/json; charset=utf-8",
      tr_id: trId,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    if (!retried && isTokenError(res.status, text)) {
      await invalidateToken();
      return kisGet(path, trId, params, true);
    }
    throw new Error(`KIS API 에러 [${trId}]: ${res.status} ${text}`);
  }

  return res.json();
}

/** 공통 POST 호출 헬퍼 */
async function kisPost(
  path: string,
  trId: string,
  body: Record<string, string>,
  retried = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const token = await getAccessToken(retried);

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      "Content-Type": "application/json; charset=utf-8",
      tr_id: trId,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (!retried && isTokenError(res.status, text)) {
      await invalidateToken();
      return kisPost(path, trId, body, true);
    }
    throw new Error(`KIS API 에러 [${trId}]: ${res.status} ${text}`);
  }

  return res.json();
}

/** 해외주식 잔고 조회 */
export async function getOverseasBalance() {
  const data = await kisGet(
    "/uapi/overseas-stock/v1/trading/inquire-balance",
    "TTTS3012R", // 해외주식 잔고 실전
    {
      CANO,
      ACNT_PRDT_CD,
      OVRS_EXCG_CD: "NASD", // 나스닥 (필요시 변경)
      TR_CRCY_CD: "USD",
      CTX_AREA_FK200: "",
      CTX_AREA_NK200: "",
    }
  );

  return data;
}

/** 해외주식 현재가 조회 */
export async function getOverseasPrice(
  symbol: string,
  exchange: string = "NAS"
) {
  const data = await kisGet(
    "/uapi/overseas-price/v1/quotations/price",
    "HHDFS00000300", // 해외주식 현재가
    {
      AUTH: "",
      EXCD: exchange,
      SYMB: symbol,
    }
  );

  return data;
}

/** 해외주식 기간별 시세 (차트용) */
export async function getOverseasDailyPrice(
  symbol: string,
  exchange: string = "NAS",
  period: string = "D", // D:일, W:주, M:월
  startDate: string = "",
  endDate: string = ""
) {
  // 날짜 기본값: 최근 30일
  if (!endDate) {
    const now = new Date();
    endDate = now.toISOString().slice(0, 10).replace(/-/g, "");
  }
  if (!startDate) {
    const d = new Date();
    d.setDate(d.getDate() - 45); // 주말 제외하면 약 30 거래일
    startDate = d.toISOString().slice(0, 10).replace(/-/g, "");
  }

  const data = await kisGet(
    "/uapi/overseas-price/v1/quotations/dailyprice",
    "HHDFS76240000",
    {
      AUTH: "",
      EXCD: exchange,
      SYMB: symbol,
      GUBN: period,
      BYMD: endDate,
      MODP: "1", // 수정주가
    }
  );

  return data;
}

/** 해외주식 매수 주문 (지정가) */
export async function buyOverseasStock(
  symbol: string,
  quantity: number,
  price: number,
  exchange: string = "NASD"
) {
  const data = await kisPost(
    "/uapi/overseas-stock/v1/trading/order",
    "TTTT1002U", // 해외주식 매수 실전
    {
      CANO,
      ACNT_PRDT_CD,
      OVRS_EXCG_CD: exchange,
      PDNO: symbol,
      ORD_QTY: String(quantity),
      OVRS_ORD_UNPR: String(price),
      ORD_SVR_DVSN_CD: "0",
      ORD_DVSN: "00", // 지정가
    }
  );

  return data;
}

/** 해외주식 매수 주문 (시장가) */
export async function buyOverseasStockMarket(
  symbol: string,
  quantity: number,
  exchange: string = "NASD"
) {
  const data = await kisPost(
    "/uapi/overseas-stock/v1/trading/order",
    "TTTT1002U",
    {
      CANO,
      ACNT_PRDT_CD,
      OVRS_EXCG_CD: exchange,
      PDNO: symbol,
      ORD_QTY: String(quantity),
      OVRS_ORD_UNPR: "0",
      ORD_SVR_DVSN_CD: "0",
      ORD_DVSN: "01", // 시장가
    }
  );

  return data;
}

/** 해외주식 매수가능금액 조회 */
export async function getBuyableAmount(
  symbol: string,
  price: number,
  exchange: string = "NASD"
) {
  const data = await kisGet(
    "/uapi/overseas-stock/v1/trading/inquire-psamount",
    "TTTS3007R",
    {
      CANO,
      ACNT_PRDT_CD,
      OVRS_EXCG_CD: exchange,
      OVRS_ORD_UNPR: String(price),
      ITEM_CD: symbol,
    }
  );

  return data;
}

/** 예수금 조회 - USD (매수가능금액 API 활용) */
export async function getDeposit() {
  const data = await kisGet(
    "/uapi/overseas-stock/v1/trading/inquire-psamount",
    "TTTS3007R",
    {
      CANO,
      ACNT_PRDT_CD,
      OVRS_EXCG_CD: "NASD",
      OVRS_ORD_UNPR: "1",
      ITEM_CD: "AAPL",
    }
  );

  return data;
}

/** 원화 예수금 조회 (국내주식 매수가능조회) */
export async function getKRWDeposit() {
  const data = await kisGet(
    "/uapi/domestic-stock/v1/trading/inquire-psbl-order",
    "TTTC8908R",
    {
      CANO,
      ACNT_PRDT_CD,
      PDNO: "005930", // 아무 종목 (삼성전자)
      ORD_UNPR: "1",
      ORD_DVSN: "01",
      CMA_EVLU_AMT_ICLD_YN: "Y",
      OVRS_ICLD_YN: "Y",
    }
  );

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// 환차손익용 추가 조회 — 해외주식 일별거래내역(적용환율) · 원/달러 일봉
// ─────────────────────────────────────────────────────────────────────────────

/** KST 기준 YYYYMMDD (offsetDays만큼 이동).
 *  KIS는 한국 영업일 기준이라 UTC 날짜를 쓰면 한국 시간 새벽엔 하루가 밀린다. */
function kstDateString(offsetDays = 0): string {
  const d = new Date(Date.now() + (9 * 60 + offsetDays * 24 * 60) * 60 * 1000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** 응답 헤더까지 필요한 GET (연속조회 tr_cont 판독용).
 *  토큰 만료 재시도는 kisGet과 동일하게 isTokenError/invalidateToken을 재사용한다.
 *  KIS는 업무 오류를 HTTP 200 + rt_cd≠"0"으로 주므로 그 경우도 throw (빈 결과로 오해 방지). */
async function kisGetRaw(
  path: string,
  trId: string,
  params: Record<string, string>,
  extraHeaders: Record<string, string> = {},
  retried = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ res: Response; body: any }> {
  const token = await getAccessToken(retried);
  const url = new URL(path, BASE_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      "Content-Type": "application/json; charset=utf-8",
      tr_id: trId,
      ...extraHeaders,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    if (!retried && isTokenError(res.status, text)) {
      await invalidateToken();
      return kisGetRaw(path, trId, params, extraHeaders, true);
    }
    throw new Error(`KIS API 에러 [${trId}]: ${res.status} ${text}`);
  }

  const body = await res.json();
  if (body?.rt_cd !== undefined && body.rt_cd !== "0") {
    throw new Error(
      `KIS API 에러 [${trId}]: ${String(body.msg_cd ?? "")} ${String(body.msg1 ?? "")}`.trim()
    );
  }
  return { res, body };
}

/** 해외주식 일별거래내역 CTOS4001R output1 한 행 (환차손익 계산에 쓰는 필드만 명시) */
export type OverseasTransaction = {
  /** 거래일 YYYYMMDD */
  trad_dt: string;
  /** 결제일 YYYYMMDD */
  sttl_dt: string;
  /** "02" 매수, "01" 매도 */
  sll_buy_dvsn_cd: string;
  sll_buy_dvsn_name: string;
  pdno: string;
  ovrs_item_name: string;
  /** 체결수량 */
  ccld_qty: string;
  /** 체결단가 (USD) */
  ft_ccld_unpr2: string;
  /** 거래금액 (USD) */
  tr_frcr_amt2: string;
  /** 거래금액 (KRW, 수수료 제외). 미정산이면 "0" */
  tr_amt: string;
  /** 원화 정산금액 (= tr_amt + 수수료) */
  wcrc_excc_amt: string;
  /** 국내수수료 (KRW) */
  dmst_wcrc_fee: string;
  /** 적용(등록)환율. 결제 전(오늘 체결) 건은 "0.00000000" */
  erlm_exrt: string;
};

export type OverseasTransactionsResult = {
  /** 전 페이지 합친 거래 행 */
  output1: OverseasTransaction[];
  /** 합계 (frcr_buy_amt_smtl 원화 매수합계, dmst_fee_smtl 수수료 합계 등). 교차검증용 */
  output2: Record<string, string> | null;
};

/** 해외주식 일별거래내역 조회 (CTOS4001R, 연속조회 포함).
 *  매수 1건마다 적용환율(erlm_exrt)이 오므로 환차손익 계산의 원천.
 *  기본 시작일 20260101 — 4월에 첫 매수가 있어 그보다 늦게 잡으면 lot이 빠진다. */
export async function getOverseasTransactions(
  startDate: string = "20260101",
  endDate: string = kstDateString()
): Promise<OverseasTransactionsResult> {
  const rows: OverseasTransaction[] = [];
  let output2: Record<string, string> | null = null;
  let fk = "";
  let nk = "";
  let more = false;

  // 연속조회: 응답 헤더 tr_cont가 F/M이면 다음 페이지가 있고,
  // 요청 헤더 tr_cont:"N" + 응답의 ctx_area_fk100/nk100을 그대로 넘겨 이어 받는다.
  for (let page = 0; page < 20; page++) {
    const { res, body } = await kisGetRaw(
      "/uapi/overseas-stock/v1/trading/inquire-period-trans",
      "CTOS4001R",
      {
        CANO,
        ACNT_PRDT_CD,
        ERLM_STRT_DT: startDate,
        ERLM_END_DT: endDate,
        OVRS_EXCG_CD: "",
        PDNO: "",
        SLL_BUY_DVSN_CD: "00", // 전체(매수+매도)
        LOAN_DVSN_CD: "",
        CTX_AREA_FK100: fk,
        CTX_AREA_NK100: nk,
      },
      more ? { tr_cont: "N" } : {}
    );

    rows.push(...((body.output1 ?? []) as OverseasTransaction[]));
    if (body.output2) output2 = body.output2 as Record<string, string>;

    fk = String(body.ctx_area_fk100 ?? "");
    nk = String(body.ctx_area_nk100 ?? "");
    const trCont = res.headers.get("tr_cont");
    more = (trCont === "F" || trCont === "M") && nk.trim() !== "";
    if (!more) break;
  }

  return { output1: rows, output2 };
}

export type UsdKrwPoint = {
  /** MM/DD */
  date: string;
  /** 종가 (시장환율) */
  rate: number;
};

export type UsdKrwQuote = {
  /** 현재 시장환율 (ovrs_nmix_prpr) */
  rate: number;
  /** 전일 종가 */
  prevClose: number;
  /** 전일 대비 (부호 포함) */
  change: number;
  /** 전일 대비 % (부호 포함) */
  changeRate: number;
};

export type UsdKrwDaily = {
  /** 오래된 → 최신 순, 최근 days 거래일 */
  points: UsdKrwPoint[];
  /** output1의 현재/전일대비. 없으면 null */
  quote: UsdKrwQuote | null;
};

/** 원/달러 일봉 (FHKST03030100 해외지수/환율 기간별시세, X=환율, FX@KRW).
 *  시장환율(KMB)이라 KIS 고시환율(getDeposit().exrt)과는 소폭 다르다 — 차트/등락 표시용. */
export async function getUsdKrwDaily(days: number = 30): Promise<UsdKrwDaily> {
  // 주말·휴일을 감안해 넉넉히 조회한 뒤 최근 days 거래일만 남긴다.
  const { body } = await kisGetRaw(
    "/uapi/overseas-price/v1/quotations/inquire-daily-chartprice",
    "FHKST03030100",
    {
      FID_COND_MRKT_DIV_CODE: "X",
      FID_INPUT_ISCD: "FX@KRW",
      FID_INPUT_DATE_1: kstDateString(-(Math.ceil(days * 1.6) + 7)),
      FID_INPUT_DATE_2: kstDateString(),
      FID_PERIOD_DIV_CODE: "D",
    }
  );

  const points: UsdKrwPoint[] = ((body.output2 ?? []) as Record<string, string>[])
    .map((d) => ({
      date: `${String(d.stck_bsop_date).slice(4, 6)}/${String(d.stck_bsop_date).slice(6, 8)}`,
      rate: Number(d.ovrs_nmix_prpr || 0),
    }))
    .filter((p) => p.rate > 0)
    .reverse() // KIS는 최신순 → 오래된순
    .slice(-days);

  let quote: UsdKrwQuote | null = null;
  const o = body.output1 as Record<string, string> | undefined;
  if (o && Number(o.ovrs_nmix_prpr) > 0) {
    // prdy_vrss_sign: 1 상한 · 2 상승 · 3 보합 · 4 하한 · 5 하락.
    // 등락폭(ovrs_nmix_prdy_vrss)은 부호 없이 올 수 있어 방향은 sign 코드로 정한다.
    const sign = o.prdy_vrss_sign;
    const rawChange = Number(o.ovrs_nmix_prdy_vrss || 0);
    const dir =
      sign === "4" || sign === "5"
        ? -1
        : sign === "1" || sign === "2"
        ? 1
        : sign === "3"
        ? 0
        : Math.sign(rawChange);
    quote = {
      rate: Number(o.ovrs_nmix_prpr),
      prevClose: Number(o.ovrs_nmix_prdy_clpr || 0),
      change: dir * Math.abs(rawChange),
      changeRate: dir * Math.abs(Number(o.prdy_ctrt || 0)),
    };
  }

  return { points, quote };
}
