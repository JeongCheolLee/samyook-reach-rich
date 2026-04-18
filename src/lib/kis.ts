// 한국투자증권 Open API 클라이언트 (실전투자)

import { put, head } from "@vercel/blob";

const BASE_URL = process.env.KIS_BASE_URL!;
const APP_KEY = process.env.KIS_APP_KEY!;
const APP_SECRET = process.env.KIS_APP_SECRET!;
const CANO = process.env.KIS_ACCOUNT_NO!;
const ACNT_PRDT_CD = process.env.KIS_ACCOUNT_PRDT!;

const TOKEN_BLOB_KEY = "kis-token.json";
const LOG_BLOB_KEY = "kis-token-log.json";
const MAX_LOG_EVENTS = 200;

// 메모리 캐시 (웜 스타트 시 재사용)
let cachedToken: { token: string; expiresAt: number } | null = null;
// 동시 요청 시 토큰 발급을 1번만 하기 위한 락
let tokenPromise: Promise<string> | null = null;

type LogEvent = { ts: number; msg: string };

/** Blob 로그에 이벤트 추가 (읽기→병합→쓰기, 동시성은 감수) */
async function writeLog(msg: string) {
  console.log(`[KIS_TOKEN] ${msg}`);
  const event: LogEvent = { ts: Date.now(), msg };
  try {
    let existing: LogEvent[] = [];
    try {
      const blob = await head(LOG_BLOB_KEY);
      const res = await fetch(blob.url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) existing = data;
      }
    } catch {
      // 로그 파일 없음 — 처음 기록
    }
    const combined = [...existing, event].slice(-MAX_LOG_EVENTS);
    await put(LOG_BLOB_KEY, JSON.stringify(combined), {
      access: "public",
      addRandomSuffix: false,
      cacheControlMaxAge: 0,
    });
  } catch {
    // 로그 쓰기 실패는 무시 (콘솔에는 남음)
  }
}

/** Blob에서 저장된 토큰 읽기 */
async function loadTokenFromBlob(): Promise<{
  token: string;
  expiresAt: number;
} | null> {
  try {
    const blob = await head(TOKEN_BLOB_KEY);
    if (!blob) {
      await writeLog("loadFromBlob: head() returned falsy");
      return null;
    }
    const res = await fetch(blob.url, { cache: "no-store" });
    if (!res.ok) {
      await writeLog(`loadFromBlob: fetch ${res.status} url=${blob.url}`);
      return null;
    }
    const data = await res.json();
    const remainingMs =
      typeof data?.expiresAt === "number" ? data.expiresAt - Date.now() : null;
    await writeLog(
      `loadFromBlob: hasToken=${!!data?.token} remainingMs=${remainingMs} uploadedAt=${blob.uploadedAt}`
    );
    if (data.token && data.expiresAt && Date.now() < data.expiresAt) {
      return data;
    }
  } catch (e) {
    await writeLog(
      `loadFromBlob: error ${(e as Error).name}: ${(e as Error).message}`
    );
  }
  return null;
}

/** Blob에 토큰 저장 */
async function saveTokenToBlob(token: string, expiresAt: number) {
  try {
    const result = await put(
      TOKEN_BLOB_KEY,
      JSON.stringify({ token, expiresAt }),
      {
        access: "public",
        addRandomSuffix: false,
        cacheControlMaxAge: 0,
      }
    );
    await writeLog(
      `saveToBlob: ok url=${result.url} expiresAt=${new Date(expiresAt).toISOString()}`
    );
  } catch (e) {
    await writeLog(
      `saveToBlob: failed ${(e as Error).name}: ${(e as Error).message}`
    );
  }
}

/** Access Token 발급 (24시간 유효, 동시 요청 시 1회만 발급, Blob 영구 저장) */
async function getAccessToken(): Promise<string> {
  // 1. 메모리 캐시 확인 (너무 빈번해서 Blob 로그에는 기록 안 함)
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    console.log(
      `[KIS_TOKEN] source=memory remainingMs=${cachedToken.expiresAt - Date.now()}`
    );
    return cachedToken.token;
  }

  // 2. Blob에서 읽기 (콜드 스타트 시)
  const blobToken = await loadTokenFromBlob();
  if (blobToken) {
    await writeLog(
      `source=blob remainingMs=${blobToken.expiresAt - Date.now()}`
    );
    cachedToken = blobToken;
    return blobToken.token;
  }

  // 3. 새로 발급 (락으로 동시 요청 방지)
  if (tokenPromise) {
    await writeLog("source=inflight (waiting for existing fetch)");
    return tokenPromise;
  }

  await writeLog("source=new (calling KIS /oauth2/tokenP)");
  tokenPromise = fetchToken();
  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
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
    await writeLog(`fetchToken failed: ${res.status} ${text}`);
    throw new Error(`Token 발급 실패: ${res.status} ${text}`);
  }

  const data = await res.json();
  const expiresAt = Date.now() + (data.expires_in - 3600) * 1000;
  await writeLog(
    `fetchToken ok: expires_in=${data.expires_in} computedExpiresAt=${new Date(expiresAt).toISOString()}`
  );
  cachedToken = { token: data.access_token, expiresAt };

  // Blob에 영구 저장 (다음 콜드 스타트에서 재사용)
  await saveTokenToBlob(data.access_token, expiresAt);

  return cachedToken.token;
}

/** 진단용: 현재 토큰 상태 + Blob 로그 읽기 */
export async function getTokenDiagnostics() {
  const memory = cachedToken
    ? {
        hasToken: true,
        expiresAt: cachedToken.expiresAt,
        remainingMs: cachedToken.expiresAt - Date.now(),
      }
    : { hasToken: false };

  let blob: {
    hasToken: boolean;
    expiresAt?: number;
    remainingMs?: number;
    uploadedAt?: string;
    url?: string;
    error?: string;
  } = { hasToken: false };
  try {
    const h = await head(TOKEN_BLOB_KEY);
    const res = await fetch(h.url, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      blob = {
        hasToken: !!data?.token,
        expiresAt: data?.expiresAt,
        remainingMs:
          typeof data?.expiresAt === "number"
            ? data.expiresAt - Date.now()
            : undefined,
        uploadedAt:
          typeof h.uploadedAt === "string"
            ? h.uploadedAt
            : h.uploadedAt?.toISOString(),
        url: h.url,
      };
    } else {
      blob = { hasToken: false, error: `fetch ${res.status}` };
    }
  } catch (e) {
    blob = { hasToken: false, error: (e as Error).message };
  }

  let events: LogEvent[] = [];
  try {
    const h = await head(LOG_BLOB_KEY);
    const res = await fetch(h.url, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) events = data;
    }
  } catch {
    // 로그 없음
  }

  return { memory, blob, events };
}

/** 진단용: Blob 로그 초기화 */
export async function clearTokenLog() {
  await put(LOG_BLOB_KEY, JSON.stringify([]), {
    access: "public",
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
  });
}

/** Cron/수동 트리거용: 캐시 무시하고 강제로 새 토큰 발급 + Blob 저장 */
export async function forceRefreshToken(): Promise<string> {
  await writeLog("forceRefreshToken: invoked");
  cachedToken = null;
  tokenPromise = null;
  return fetchToken();
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
