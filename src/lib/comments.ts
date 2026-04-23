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
}

export async function listComments(): Promise<Comment[]> {
  const raw = await redis.lrange<Comment>(COMMENTS_KEY, 0, MAX_COMMENTS - 1);
  return raw;
}

export async function addComment(
  author: string,
  icon: string,
  text: string
): Promise<Comment> {
  const comment: Comment = {
    id: crypto.randomUUID(),
    author,
    icon,
    text,
    createdAt: Date.now(),
  };
  await redis.lpush(COMMENTS_KEY, comment);
  await redis.ltrim(COMMENTS_KEY, 0, MAX_COMMENTS - 1);
  return comment;
}

export async function deleteComment(id: string): Promise<number> {
  const all = await redis.lrange<Comment>(COMMENTS_KEY, 0, MAX_COMMENTS - 1);
  const target = all.find((c) => c.id === id);
  if (!target) return 0;
  return redis.lrem(COMMENTS_KEY, 0, target);
}
