import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { getPool, query } from "../src/server/db";
import { archiveMember, createMember, DomainError, getMembers, updateMember } from "../src/server/services/members";
import { addDeposit, deleteDeposit, listDeposits } from "../src/server/services/deposits";
import { addComment, deleteComment, listComments } from "../src/server/services/comments";
import { bumpViews, getViews } from "../src/server/services/views";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  const database = new URL(databaseUrl).pathname;
  if (!database.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to a disposable database ending in _test");
  process.env.DATABASE_URL = databaseUrl;
}

describe("PostgreSQL domain integration", { skip: !databaseUrl }, () => {
  before(async () => {
    await query("SELECT id FROM members LIMIT 0");
  });
  beforeEach(async () => {
    await query("TRUNCATE TABLE comments, deposits, members, daily_views, view_totals CASCADE");
  });
  after(async () => { await getPool().end(); });

  it("starts empty without runtime sample seeding", async () => {
    assert.deepEqual(await getMembers(), []);
    assert.deepEqual(await listDeposits(), []);
    assert.deepEqual(await getViews(), { total: 0, today: 0 });
  });

  it("preserves every concurrent deposit and computes the total from the ledger", async () => {
    const member = await createMember({ name: "동시성", icon: "🐻" });
    const amounts = Array.from({ length: 30 }, (_, i) => i % 3 === 0 ? -100 : 200);
    const deposits = await Promise.all(amounts.map((amount) => addDeposit({
      memberId: member.id, amount, depositedAt: Date.now(),
    })));
    const [updated] = await getMembers();
    assert.equal(updated.totalContributed, amounts.reduce((a, b) => a + b, 0));
    assert.equal(updated.version, 31);
    assert.equal((await listDeposits()).length, 30);
    const deleted = await Promise.all([deleteDeposit(deposits[0].id), deleteDeposit(deposits[0].id)]);
    assert.equal(deleted.filter(Boolean).length, 1);
    assert.equal((await getMembers())[0].totalContributed, updated.totalContributed - amounts[0]);
  });

  it("rejects stale balance edits after a deposit, and records valid edits as adjustments", async () => {
    const member = await createMember({ name: "잔액", icon: "🐯" });
    await addDeposit({ memberId: member.id, amount: 1000, depositedAt: Date.now() });
    await assert.rejects(
      updateMember(member.id, { expectedVersion: member.version, totalContributed: 50 }),
      (error: unknown) => error instanceof DomainError && error.code === "stale_member",
    );
    const [current] = await getMembers();
    const adjusted = await updateMember(member.id, { expectedVersion: current.version, totalContributed: 1500 });
    assert.equal(adjusted.totalContributed, 1500);
    const ledger = await listDeposits();
    assert.equal(ledger.find((d) => d.kind === "adjustment")?.amount, 500);
    assert.equal(ledger.find((d) => d.kind === "deposit")?.amount, 1000);
    const edits = await Promise.allSettled([
      updateMember(member.id, { expectedVersion: adjusted.version, totalContributed: 2000 }),
      updateMember(member.id, { expectedVersion: adjusted.version, totalContributed: 3000 }),
    ]);
    assert.equal(edits.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(edits.filter((result) => result.status === "rejected").length, 1);
  });

  it("rolls back an adjustment when a duplicate name update fails", async () => {
    const first = await createMember({ name: "첫째", icon: "🐻" });
    await createMember({ name: "둘째", icon: "🐯" });
    await assert.rejects(updateMember(first.id, {
      expectedVersion: first.version, name: "둘째", totalContributed: 1000,
    }), (error: unknown) => error instanceof DomainError && error.code === "duplicate_member");
    const current = (await getMembers()).find((member) => member.id === first.id)!;
    assert.equal(current.version, first.version);
    assert.equal(current.totalContributed, 0);
    assert.deepEqual(await listDeposits(), []);
  });

  it("archives a member without losing history or attaching it to a new namesake", async () => {
    const member = await createMember({ name: "동명이인", icon: "🐻" });
    await addDeposit({ memberId: member.id, amount: 500, depositedAt: Date.now() });
    await archiveMember(member.id, (await getMembers())[0].version);
    assert.deepEqual(await getMembers(), []);
    assert.equal((await listDeposits())[0].memberId, member.id);
    await assert.rejects(addDeposit({ memberId: member.id, amount: 100, depositedAt: Date.now() }),
      (error: unknown) => error instanceof DomainError && error.status === 404);
    const replacement = await createMember({ name: "동명이인", icon: "🐱" });
    assert.notEqual(replacement.id, member.id);
    assert.equal(replacement.totalContributed, 0);
  });

  it("protects imported opening balances while allowing explicit balance adjustments", async () => {
    const member = await createMember({ name: "이전 잔액", icon: "🐻" });
    const id = "00000000-0000-4000-8000-000000000001";
    await query(`INSERT INTO deposits(id, member_id, amount, kind, deposited_at)
      VALUES ($1, $2, 500, 'opening', now())`, [id, member.id]);
    await assert.rejects(deleteDeposit(id),
      (error: unknown) => error instanceof DomainError && error.code === "opening_balance_protected");
    assert.equal((await getMembers())[0].totalContributed, 500);
    const adjusted = await updateMember(member.id, { expectedVersion: member.version, totalContributed: 600 });
    assert.equal(adjusted.totalContributed, 600);
    assert.equal((await listDeposits()).find((d) => d.id === id)?.amount, 500);
  });

  it("preserves author snapshots and deletes a thread including replies", async () => {
    const member = await createMember({ name: "댓글", icon: "🐻" });
    const parent = await addComment(member.name, member.icon, "원문");
    const child = await addComment(member.name, member.icon, "답글", parent.id, { ip: "127.0.0.1" });
    await assert.rejects(addComment(member.name, member.icon, "중첩", child.id), DomainError);
    await updateMember(member.id, { expectedVersion: member.version, name: "새 이름", icon: "🐱" });
    const stored = await listComments();
    assert.equal(stored[0].author, "댓글");
    assert.equal(stored[0].icon, "🐻");
    assert.equal(await deleteComment(parent.id), 2);
    assert.deepEqual(await listComments(), []);
  });

  it("keeps historical total independent of retained daily counts and increments atomically", async () => {
    await query("INSERT INTO view_totals(id,total) VALUES (1, 1000)");
    await query("INSERT INTO daily_views(day,count) VALUES ('2000-01-01', 5)");
    await Promise.all(Array.from({ length: 20 }, () => bumpViews()));
    assert.deepEqual(await getViews(), { total: 1020, today: 20 });
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    await query("UPDATE daily_views SET expires_at = now() - interval '1 second' WHERE day = $1", [date]);
    assert.deepEqual(await getViews(), { total: 1020, today: 0 });
    assert.deepEqual(await bumpViews(), { total: 1021, today: 1 });
  });

  it("rejects fractional or overflowing money without changing the ledger", async () => {
    const member = await createMember({ name: "검증", icon: "🐻" });
    await assert.rejects(addDeposit({ memberId: member.id, amount: 0.1, depositedAt: Date.now() }), DomainError);
    await addDeposit({ memberId: member.id, amount: Number.MAX_SAFE_INTEGER, depositedAt: Date.now() });
    await assert.rejects(addDeposit({ memberId: member.id, amount: 1, depositedAt: Date.now() }), DomainError);
    assert.equal((await listDeposits()).length, 1);
    assert.equal((await getMembers())[0].totalContributed, Number.MAX_SAFE_INTEGER);
  });
});
