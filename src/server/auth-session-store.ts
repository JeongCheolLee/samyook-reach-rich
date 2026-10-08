import "server-only";
import { query, withTransaction } from "./db";
import { hashToken, newSessionToken, SESSION_TTL_SECONDS, validSessionToken } from "./auth-core";

export async function hasActiveSession(token: unknown): Promise<boolean> {
  if (!validSessionToken(token)) return false;
  const result = await query("SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()", [hashToken(token)]);
  return result.rows.length > 0;
}

export async function consumeLoginAttempt(): Promise<boolean> {
  // A single global bucket prevents bypass through spoofed forwarding headers.
  const result = await query<{ attempts: number }>(`
    INSERT INTO auth_rate_limits (bucket, attempts, window_start) VALUES ('admin-login', 1, now())
    ON CONFLICT (bucket) DO UPDATE SET
      attempts = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE LEAST(auth_rate_limits.attempts + 1, 31) END,
      window_start = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END
    RETURNING attempts
  `);
  return result.rows[0].attempts <= 30;
}

export async function issueSession(previous?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await withTransaction(async (client) => {
    await client.query("DELETE FROM admin_sessions WHERE expires_at <= now() OR token_hash = $1", [previous ? hashToken(previous) : ""]);
    await client.query("INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)", [hashToken(token), expiresAt]);
  });
  return { token, expiresAt };
}

export async function revokeSession(token: unknown): Promise<void> {
  if (validSessionToken(token)) await query("DELETE FROM admin_sessions WHERE token_hash = $1", [hashToken(token)]);
}
