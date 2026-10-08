import "server-only";
import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db";
import { assertId, DomainError } from "./members";

export interface Comment {
  id: string;
  author: string;
  icon: string;
  text: string;
  createdAt: number;
  parentId: string | null;
  ip: string | null;
  ua: string | null;
  device: string | null;
  geo: string | null;
  isp: string | null;
}
export interface CommentMeta {
  ip?: string | null;
  ua?: string | null;
  device?: string | null;
  geo?: string | null;
  isp?: string | null;
}

type CommentRow = Omit<Comment, "parentId" | "createdAt"> & { parent_id: string | null; created_at: Date };
const toComment = (row: CommentRow): Comment => ({
  id: row.id, author: row.author, icon: row.icon, text: row.text,
  createdAt: row.created_at.getTime(), parentId: row.parent_id,
  ip: row.ip, ua: row.ua, device: row.device, geo: row.geo, isp: row.isp,
});

export async function listComments(): Promise<Comment[]> {
  const result = await query<CommentRow>("SELECT * FROM comments ORDER BY created_at DESC, id");
  return result.rows.map(toComment);
}

export async function addComment(
  author: string,
  icon: string,
  text: string,
  parentId: string | null = null,
  meta: CommentMeta = {},
): Promise<Comment> {
  if (typeof text !== "string" || !text.trim() || text.trim().length > 500) {
    throw new DomainError("댓글은 1~500자로 입력해주세요");
  }
  if (parentId) assertId(parentId);
  return withTransaction(async (client) => {
    const member = await client.query("SELECT name, icon FROM members WHERE active AND name = $1 FOR SHARE", [author]);
    if (!member.rowCount) throw new DomainError("등록된 멤버가 아닙니다");
    if (parentId) {
      const parent = await client.query("SELECT parent_id FROM comments WHERE id = $1 FOR SHARE", [parentId]);
      if (!parent.rowCount) throw new DomainError("존재하지 않는 댓글입니다", 404, "comment_not_found");
      if (parent.rows[0].parent_id) throw new DomainError("답글에는 답글을 달 수 없습니다");
    }
    const result = await client.query<CommentRow>(`INSERT INTO comments
      (id, author, icon, text, parent_id, ip, ua, device, geo, isp)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [
      randomUUID(), member.rows[0].name, member.rows[0].icon, text.trim(), parentId,
      meta.ip ?? null, meta.ua ?? null, meta.device ?? null, meta.geo ?? null, meta.isp ?? null,
    ]);
    return toComment(result.rows[0]);
  });
}

export async function deleteComment(id: string): Promise<number> {
  assertId(id);
  const result = await query(`WITH RECURSIVE targets AS (
    SELECT id FROM comments WHERE id = $1
    UNION ALL SELECT c.id FROM comments c JOIN targets t ON c.parent_id = t.id
  ) DELETE FROM comments WHERE id IN (SELECT id FROM targets) RETURNING id`, [id]);
  return result.rowCount ?? 0;
}
