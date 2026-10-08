// Run against a locally running app with an isolated PostgreSQL *_test database.
// APP_URL and HTTP_SMOKE_URL must match the app's origin; credentials come from env.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool } from "pg";

async function main() {
  const base = new URL(process.env.HTTP_SMOKE_URL ?? "http://127.0.0.1:3100");
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL for the app's test database is required");
  const dbUrl = new URL(databaseUrl);
  const local = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  assert.ok(local.has(base.hostname) && local.has(dbUrl.hostname) && dbUrl.pathname.endsWith("_test"), "Smoke tests only target localhost with a *_test database");
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  assert.ok(username && password, "Test admin credentials are required");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  let cookie = "";
  let member: { id: string; version: number } | undefined;
  const commentIds: string[] = [];
  const depositIds: string[] = [];
  const name = `smoke-${Date.now()}`;
  let verifiedDatabase = false;
  const request = (path: string, method = "GET", body?: unknown, auth = true, origin = base.origin) => fetch(new URL(path, base), {
    method,
    headers: { origin, ...(auth && cookie ? { cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    assert.equal((await request("/api/auth/check")).status, 401);
    for (const [path, method] of [["/api/members", "PUT"], ["/api/deposits", "POST"], ["/api/deposits?id=invalid", "DELETE"], ["/api/comments?id=invalid", "DELETE"]]) {
      assert.equal((await request(path, method, method === "DELETE" ? undefined : {})).status, 401, `${method} ${path} must require a session`);
    }
    const legacy = await fetch(new URL("/api/comments?id=invalid", base), { method: "DELETE", headers: { origin: base.origin, cookie: "admin_token=forged" } });
    assert.equal(legacy.status, 401);
    assert.equal((await request("/api/auth", "POST", { username, password }, false, "https://evil.example")).status, 403);
    assert.equal((await request("/api/auth", "POST", { username }, false)).status, 400);
    assert.equal((await request("/api/auth", "POST", { username, password: "deliberately-wrong" }, false)).status, 401);
    const login = await request("/api/auth", "POST", { username, password }, false);
    assert.equal(login.status, 200, "Login must succeed");
    const sessionHeader = login.headers.getSetCookie().find((value) => value.startsWith("admin_session="));
    assert.ok(sessionHeader);
    assert.match(sessionHeader, /HttpOnly/i);
    assert.match(sessionHeader, /SameSite=lax/i);
    assert.match(sessionHeader, /Path=\//i);
    if (process.env.NODE_ENV === "production") assert.match(sessionHeader, /; Secure/i);
    cookie = sessionHeader.split(";")[0];
    const tokenHash = createHash("sha256").update(cookie.slice("admin_session=".length)).digest("hex");
    const session = await pool.query("SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()", [tokenHash]);
    assert.equal(session.rowCount, 1, "Before domain writes, prove the HTTP app uses this isolated test database");
    verifiedDatabase = true;
    assert.equal((await request("/api/auth/check")).status, 200);
    assert.equal((await request("/api/members", "PUT", { action: "create", name, icon: "🐻" }, true, "https://evil.example")).status, 403);
    const malformed = await fetch(new URL("/api/members", base), { method: "PUT", headers: { origin: base.origin, cookie, "Content-Type": "application/json" }, body: "{" });
    assert.equal(malformed.status, 400);
    const created = await request("/api/members", "PUT", { action: "create", name, icon: "🐻" });
    assert.equal(created.status, 200);
    member = (await created.json()).find((value: { name: string }) => value.name === name);
    assert.ok(member?.id);
    assert.equal((await request("/api/deposits", "POST", { memberId: member.id, amount: 0.5, depositedAt: Date.now() })).status, 400);
    const deposited = await request("/api/deposits", "POST", { memberId: member.id, amount: 50000, depositedAt: Date.now(), memo: "HTTP smoke" });
    assert.equal(deposited.status, 200);
    const depositData = await deposited.json();
    depositIds.push(depositData.deposit.id);
    assert.equal(depositData.members.find((value: { id: string }) => value.id === member!.id).totalContributed, 50000);
    const conflict = await request("/api/members", "PUT", { action: "update", id: member.id, expectedVersion: member.version, totalContributed: 1 });
    assert.equal(conflict.status, 409, "Old member version cannot erase a new deposit");
    const current = depositData.members.find((value: { id: string }) => value.id === member!.id);
    const adjusted = await request("/api/members", "PUT", { action: "update", id: member.id, expectedVersion: current.version, totalContributed: 70000 });
    assert.equal(adjusted.status, 200);
    const adjustedMembers = await adjusted.json();
    assert.equal(adjustedMembers.find((value: { id: string }) => value.id === member!.id).totalContributed, 70000);
    const allDeposits = await (await request("/api/deposits")).json();
    const adjustment = allDeposits.find((value: { memberId: string; kind: string }) => value.memberId === member!.id && value.kind === "adjustment");
    assert.equal(adjustment.amount, 20000);
    depositIds.push(adjustment.id);
    const comment = await request("/api/comments", "POST", { authorId: member.id, text: "HTTP smoke comment" }, false);
    assert.equal(comment.status, 200);
    const parentId = (await comment.json()).id;
    commentIds.push(parentId);
    const reply = await request("/api/comments", "POST", { authorId: member.id, text: "HTTP smoke reply", parentId }, false);
    assert.equal(reply.status, 200);
    const replyId = (await reply.json()).id;
    commentIds.push(replyId);
    assert.equal((await request("/api/comments", "POST", { authorId: member.id, text: "Invalid nested reply", parentId: replyId }, false)).status, 400);
    assert.equal((await request(`/api/comments?id=${parentId}`, "DELETE")).status, 200);
    const remainingComments = await (await request("/api/comments")).json();
    assert.equal(remainingComments.some((value: { id: string }) => commentIds.includes(value.id)), false);
    console.log("HTTP smoke passed: authorization, CSRF, login cookie, validation, deposits, stale edits, adjustment ledger, public comments/replies.");
  } finally {
    if (verifiedDatabase) {
      for (const id of commentIds) await request(`/api/comments?id=${id}`, "DELETE");
      for (const id of depositIds) await request(`/api/deposits?id=${id}`, "DELETE");
      if (member) {
        const members = await (await request("/api/members")).json();
        const current = members.find((value: { id: string }) => value.id === member!.id);
        if (current) await request("/api/members", "PUT", { action: "archive", id: current.id, expectedVersion: current.version });
      }
    }
    if (cookie) {
      assert.equal((await request("/api/auth", "DELETE")).status, 200);
      assert.equal((await request("/api/auth/check")).status, 401, "Copied cookie must fail after logout");
      console.log("HTTP smoke passed: logout revokes the server session.");
    }
    await pool.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "HTTP smoke failed"); process.exitCode = 1; });
