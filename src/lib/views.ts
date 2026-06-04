import { Redis } from "@upstash/redis";

const TOTAL_KEY = "views:total";
const DAY_TTL = 60 * 60 * 24 * 90; // 일별 키는 90일 후 자동 만료

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export interface ViewCounts {
  total: number;
  today: number;
}

// 오늘 날짜(Asia/Seoul) YYYY-MM-DD
function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// 방문 1회 집계: 누적 + 오늘 카운트 증가
export async function bumpViews(): Promise<ViewCounts> {
  const dayKey = `views:day:${todayKST()}`;
  const [total, today] = await Promise.all([
    redis.incr(TOTAL_KEY),
    redis.incr(dayKey),
  ]);
  await redis.expire(dayKey, DAY_TTL);
  return { total, today };
}

// 증가 없이 현재값만 조회
export async function getViews(): Promise<ViewCounts> {
  const dayKey = `views:day:${todayKST()}`;
  const [total, today] = await Promise.all([
    redis.get<number>(TOTAL_KEY),
    redis.get<number>(dayKey),
  ]);
  return { total: total ?? 0, today: today ?? 0 };
}
