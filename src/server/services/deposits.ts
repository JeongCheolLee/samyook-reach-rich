import "server-only";
import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db";
import { assertAmount, assertId, DomainError, safeNumber } from "./members";

export interface Deposit {
  id: string;
  memberId: string;
  memberName: string;
  amount: number;
  kind: "deposit" | "adjustment" | "opening";
  depositedAt: number;
  createdAt: number;
  memo?: string;
}

type DepositRow = {
  id: string; member_id: string; member_name: string; amount: string; kind: Deposit["kind"];
  deposited_at: Date; created_at: Date; memo: string | null;
};
const depositSelect = `SELECT d.*, m.name AS member_name FROM deposits d JOIN members m ON m.id = d.member_id`;
const toDeposit = (row: DepositRow): Deposit => ({
  id: row.id, memberId: row.member_id, memberName: row.member_name,
  amount: safeNumber(row.amount), kind: row.kind,
  depositedAt: row.deposited_at.getTime(), createdAt: row.created_at.getTime(), memo: row.memo ?? undefined,
});

export async function listDeposits(): Promise<Deposit[]> {
  const result = await query<DepositRow>(`${depositSelect} ORDER BY d.deposited_at DESC, d.created_at DESC, d.id`);
  return result.rows.map(toDeposit);
}

export async function addDeposit(input: {
  memberName?: string;
  memberId?: string;
  amount: number;
  depositedAt: number;
  memo?: string;
}): Promise<Deposit> {
  assertAmount(input.amount);
  if (input.amount === 0) throw new DomainError("금액은 0일 수 없습니다");
  if (input.memberId) assertId(input.memberId);
  if (!input.memberId && !input.memberName?.trim()) throw new DomainError("멤버가 필요합니다");
  if (!Number.isSafeInteger(input.depositedAt) || !Number.isFinite(new Date(input.depositedAt).getTime())) {
    throw new DomainError("잘못된 납입일입니다");
  }
  if (input.memo && input.memo.length > 2000) throw new DomainError("메모는 2000자 이내여야 합니다");
  return withTransaction(async (client) => {
    const member = await client.query<{ id: string; name: string }>(
      input.memberId
        ? "SELECT id, name FROM members WHERE id = $1 AND active FOR UPDATE"
        : "SELECT id, name FROM members WHERE name = $1 AND active FOR UPDATE",
      [input.memberId ?? input.memberName?.trim()],
    );
    if (!member.rowCount) throw new DomainError("멤버를 찾을 수 없습니다", 404, "member_not_found");
    const memberId = member.rows[0].id;
    const total = await client.query("SELECT COALESCE(SUM(amount), 0)::text AS total FROM deposits WHERE member_id = $1", [memberId]);
    assertAmount(safeNumber(total.rows[0].total) + input.amount);
    const id = randomUUID();
    await client.query(`INSERT INTO deposits(id, member_id, amount, deposited_at, memo)
      VALUES ($1, $2, $3, $4, $5)`, [id, memberId, input.amount, new Date(input.depositedAt), input.memo?.trim() || null]);
    await client.query("UPDATE members SET version = version + 1 WHERE id = $1", [memberId]);
    const result = await client.query<DepositRow>(`${depositSelect} WHERE d.id = $1`, [id]);
    return toDeposit(result.rows[0]);
  });
}

export async function deleteDeposit(id: string): Promise<Deposit | null> {
  assertId(id);
  return withTransaction(async (client) => {
    // All ledger mutations lock the member first, so concurrent deletions/adjustments use the same order.
    const target = await client.query<{ member_id: string }>("SELECT member_id FROM deposits WHERE id = $1", [id]);
    if (!target.rowCount) return null;
    const memberId = target.rows[0].member_id;
    await client.query("SELECT id FROM members WHERE id = $1 FOR UPDATE", [memberId]);
    const current = await client.query<DepositRow>(`${depositSelect} WHERE d.id = $1`, [id]);
    if (!current.rowCount) return null;
    const removed = toDeposit(current.rows[0]);
    if (removed.kind === "opening") {
      throw new DomainError("이전 기준 잔액은 삭제할 수 없습니다. 잔액 조정을 사용해주세요", 409, "opening_balance_protected");
    }
    const total = await client.query("SELECT COALESCE(SUM(amount), 0)::text AS total FROM deposits WHERE member_id = $1", [memberId]);
    assertAmount(safeNumber(total.rows[0].total) - removed.amount);
    await client.query("DELETE FROM deposits WHERE id = $1", [id]);
    await client.query("UPDATE members SET version = version + 1 WHERE id = $1", [memberId]);
    return removed;
  });
}
