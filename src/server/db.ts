import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalDb = globalThis as typeof globalThis & { reachRichPool?: Pool };

export function getPool(): Pool {
  if (!globalDb.reachRichPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const max = Number(process.env.DATABASE_POOL_MAX ?? 5);
    if (!Number.isInteger(max) || max < 1 || max > 50) {
      throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 50");
    }
    globalDb.reachRichPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
      application_name: "reach-rich",
    });
    globalDb.reachRichPool.on("error", (error) => {
      console.error("PostgreSQL idle connection error", error.message);
    });
  }
  return globalDb.reachRichPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values?: unknown[],
) {
  return getPool().query<T>(sql, values);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
