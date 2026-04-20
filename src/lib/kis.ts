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
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const stored = await redis.get<StoredToken>(TOKEN_KEY);
  if (stored && Date.now() < stored.expiresAt) {
    cachedToken = stored;
    return stored.token;
  }

  if (tokenPromise) return tokenPromise;

  tokenPromise = acquireLockAndFetch();
  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
}

async function acquireLockAndFetch(): Promise<string> {
  // SET NX EX 60 → 60초 락
  const gotLock = await redis.set(TOKEN_LOCK_KEY, "1", { nx: true, ex: 60 });

  if (!gotLock) {
    // 다른 인스턴스가 발급 중 → 잠시 기다렸다가 Redis 재조회
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const stored = await redis.get<StoredToken>(TOKEN_KEY);
      if (stored && Date.now() < stored.expiresAt) {
        cachedToken = stored;
        return stored.token;
      }
    }
    // 끝내 못 받으면 내가 시도
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token 발급 실패: ${res.status} ${text}`);
  }

  const data = await res.json();
  const expiresAt = Date.now() + (data.expires_in - 3600) * 1000;
  cachedToken = { token: data.access_token, expiresAt };

  const ttlSeconds = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
  await redis.set(TOKEN_KEY, cachedToken, { ex: ttlSeconds });

  return cachedToken.token;
}

/** 공통 GET 호출 헬퍼 */
async function kisGet(
  path: string,
  trId: string,
  params: Record<string, string>
) {
  const token = await getAccessToken();
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
    throw new Error(`KIS API 에러 [${trId}]: ${res.status} ${text}`);
  }

  return res.json();
}

/** 공통 POST 호출 헬퍼 */
async function kisPost(
  path: string,
  trId: string,
  body: Record<string, string>
) {
  const token = await getAccessToken();

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
