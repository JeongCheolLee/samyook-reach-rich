import "server-only";
import { query, withTransaction } from "../db";
import { safeNumber } from "./members";

export interface ViewCounts { total: number; today: number }

function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export async function bumpViews(): Promise<ViewCounts> {
  const day = todayKST();
  return withTransaction(async (client) => {
    const total = await client.query(`INSERT INTO view_totals(id, total) VALUES (1, 1)
      ON CONFLICT (id) DO UPDATE SET total = view_totals.total + 1 RETURNING total`);
    const today = await client.query(`INSERT INTO daily_views(day, count) VALUES ($1, 1)
      ON CONFLICT (day) DO UPDATE SET
        count = CASE WHEN daily_views.expires_at <= now() THEN 1 ELSE daily_views.count + 1 END,
        expires_at = NULL RETURNING count`, [day]);
    return { total: safeNumber(total.rows[0].total), today: safeNumber(today.rows[0].count) };
  });
}

export async function getViews(): Promise<ViewCounts> {
  const result = await query(`SELECT
    COALESCE((SELECT total FROM view_totals WHERE id = 1), 0)::text AS total,
    COALESCE((SELECT count FROM daily_views WHERE day = $1 AND (expires_at IS NULL OR expires_at > now())), 0)::text AS today`, [todayKST()]);
  return { total: safeNumber(result.rows[0].total), today: safeNumber(result.rows[0].today) };
}
