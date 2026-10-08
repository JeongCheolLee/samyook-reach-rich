import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { getPool, query } from "../src/server/db";
import { consumeLoginAttempt, hasActiveSession, issueSession, revokeSession } from "../src/server/auth-session-store";
import { hashToken, newSessionToken } from "../src/server/auth-core";

const connection = process.env.DATABASE_URL;
const enabled = Boolean(connection && new URL(connection).pathname.endsWith("_test"));
before(async () => {
  if (!enabled) return;
  // Destructive setup is permitted only in an explicitly named local test DB.
  const host = new URL(connection!).hostname;
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(host));
  await query("DROP TABLE IF EXISTS admin_sessions, auth_rate_limits");
  await query(await readFile("db/migrations/002_auth.sql", "utf8"));
});
after(async () => { if (enabled) await getPool().end(); });

test("database sessions reject forged/expired tokens, rotate and revoke on logout", { skip: !enabled }, async () => {
  assert.equal(await hasActiveSession("forged"), false);
  assert.equal(await hasActiveSession(newSessionToken()), false);
  const first = await issueSession();
  assert.equal(await hasActiveSession(first.token), true);
  const stored = await query("SELECT token_hash FROM admin_sessions");
  assert.equal(stored.rows[0].token_hash, hashToken(first.token));
  const second = await issueSession(first.token);
  assert.equal(await hasActiveSession(first.token), false);
  assert.equal(await hasActiveSession(second.token), true);
  await revokeSession(second.token);
  assert.equal(await hasActiveSession(second.token), false);
  const expired = await issueSession();
  await query("UPDATE admin_sessions SET expires_at = now() - interval '1 second'");
  assert.equal(await hasActiveSession(expired.token), false);
});

test("login throttle is atomic under concurrency and releases after its window", { skip: !enabled }, async () => {
  await query("DELETE FROM auth_rate_limits");
  const results = await Promise.all(Array.from({ length: 40 }, () => consumeLoginAttempt()));
  assert.equal(results.filter(Boolean).length, 30);
  assert.equal(await consumeLoginAttempt(), false);
  await query("UPDATE auth_rate_limits SET window_start = now() - interval '16 minutes'");
  assert.equal(await consumeLoginAttempt(), true);
});
