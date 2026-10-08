import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Member } from "../../lib/mock-data";
import { query, withTransaction } from "../db";

export interface MemberRecord extends Member {
  id: string;
  version: number;
}

export class DomainError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = "invalid_input") {
    super(message);
    this.name = "DomainError";
  }
}

export function assertId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new DomainError("잘못된 ID입니다");
  }
}

export function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount)) throw new DomainError("금액은 안전한 범위의 원 단위 정수여야 합니다");
}

export function safeNumber(value: string | number): number {
  const amount = Number(value);
  assertAmount(amount);
  return amount;
}

function validateText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) {
    throw new DomainError(`${label}을(를) 1~100자로 입력해주세요`);
  }
  return value.trim();
}

const memberSelect = `SELECT m.id, m.name, m.icon, m.version,
  COALESCE((SELECT SUM(d.amount) FROM deposits d WHERE d.member_id = m.id), 0)::text AS total
  FROM members m`;

type MemberRow = { id: string; name: string; icon: string; version: number; total: string };
const toMember = (row: MemberRow): MemberRecord => ({
  id: row.id, name: row.name, icon: row.icon, version: row.version, totalContributed: safeNumber(row.total),
});

async function readMember(client: PoolClient, id: string): Promise<MemberRecord> {
  const result = await client.query<MemberRow>(`${memberSelect} WHERE m.id = $1`, [id]);
  return toMember(result.rows[0]);
}

function rethrowConstraint(error: unknown): never {
  if ((error as { code?: string })?.code === "23505") {
    throw new DomainError("같은 이름의 멤버가 이미 있습니다", 409, "duplicate_member");
  }
  throw error;
}

export async function getMembers(): Promise<MemberRecord[]> {
  const result = await query<MemberRow>(`${memberSelect} WHERE m.active`);
  return result.rows.map(toMember).sort((a, b) =>
    b.totalContributed - a.totalContributed || a.name.localeCompare(b.name, "ko"));
}

export async function createMember(input: { name: string; icon: string }): Promise<MemberRecord> {
  const name = validateText(input.name, "이름");
  const icon = validateText(input.icon, "아이콘");
  try {
    return await withTransaction(async (client) => {
      const id = randomUUID();
      await client.query("INSERT INTO members(id, name, icon) VALUES ($1, $2, $3)", [id, name, icon]);
      return readMember(client, id);
    });
  } catch (error) { return rethrowConstraint(error); }
}

async function lockVersion(client: PoolClient, id: string, expectedVersion: number): Promise<void> {
  assertId(id);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new DomainError("멤버 버전이 필요합니다");
  }
  const result = await client.query("SELECT version FROM members WHERE id = $1 AND active FOR UPDATE", [id]);
  if (!result.rowCount) throw new DomainError("멤버를 찾을 수 없습니다", 404, "member_not_found");
  if (result.rows[0].version !== expectedVersion) {
    throw new DomainError("다른 작업으로 변경되었습니다. 새로고침 후 다시 시도해주세요", 409, "stale_member");
  }
}

export async function updateMember(id: string, input: {
  expectedVersion: number;
  name?: string;
  icon?: string;
  totalContributed?: number;
}): Promise<MemberRecord> {
  const name = input.name === undefined ? null : validateText(input.name, "이름");
  const icon = input.icon === undefined ? null : validateText(input.icon, "아이콘");
  if (input.totalContributed !== undefined) assertAmount(input.totalContributed);
  try {
    return await withTransaction(async (client) => {
      await lockVersion(client, id, input.expectedVersion);
      if (input.totalContributed !== undefined) {
        const member = await readMember(client, id);
        const delta = input.totalContributed - member.totalContributed;
        assertAmount(delta);
        if (delta !== 0) {
          await client.query(`INSERT INTO deposits(id, member_id, amount, kind, deposited_at, memo)
            VALUES ($1, $2, $3, 'adjustment', now(), '관리자 잔액 조정')`, [randomUUID(), id, delta]);
        }
      }
      await client.query(`UPDATE members SET name = COALESCE($2, name), icon = COALESCE($3, icon),
        version = version + 1 WHERE id = $1`, [id, name, icon]);
      return readMember(client, id);
    });
  } catch (error) { return rethrowConstraint(error); }
}

export async function archiveMember(id: string, expectedVersion: number): Promise<void> {
  await withTransaction(async (client) => {
    await lockVersion(client, id, expectedVersion);
    await client.query("UPDATE members SET active = false, version = version + 1 WHERE id = $1", [id]);
  });
}
