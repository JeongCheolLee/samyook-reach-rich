import { Redis } from "@upstash/redis";

const COMMENTS_KEY = "comments:global";
const MAX_COMMENTS = 500;

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export interface Comment {
  id: string;
  author: string;
  icon: string;
  text: string;
  createdAt: number;
  // null = 최상위 댓글, string = 해당 id 댓글에 달린 답글
  parentId: string | null;
  // 접속 정보 (작성자 추정용, 모두에게 공개)
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

export async function listComments(): Promise<Comment[]> {
  const raw = await redis.lrange<Comment>(COMMENTS_KEY, 0, MAX_COMMENTS - 1);
  return raw;
}

export async function addComment(
  author: string,
  icon: string,
  text: string,
  parentId: string | null = null,
  meta: CommentMeta = {}
): Promise<Comment> {
  const comment: Comment = {
    id: crypto.randomUUID(),
    author,
    icon,
    text,
    createdAt: Date.now(),
    parentId,
    ip: meta.ip ?? null,
    ua: meta.ua ?? null,
    device: meta.device ?? null,
    geo: meta.geo ?? null,
    isp: meta.isp ?? null,
  };
  await redis.lpush(COMMENTS_KEY, comment);
  await redis.ltrim(COMMENTS_KEY, 0, MAX_COMMENTS - 1);
  return comment;
}

// 댓글 삭제. 최상위 댓글이면 그에 달린 답글도 함께 삭제(고아 답글 방지).
export async function deleteComment(id: string): Promise<number> {
  const all = await redis.lrange<Comment>(COMMENTS_KEY, 0, MAX_COMMENTS - 1);
  const targets = all.filter((c) => c.id === id || c.parentId === id);
  if (targets.length === 0) return 0;
  let removed = 0;
  for (const t of targets) {
    removed += await redis.lrem(COMMENTS_KEY, 0, t);
  }
  return removed;
}
