import { Redis } from "@upstash/redis";

const DEPOSITS_KEY = "deposits:list";
const MAX_DEPOSITS = 1000;

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export interface Deposit {
  id: string;
  memberName: string;
  amount: number;
  depositedAt: number;
  createdAt: number;
  memo?: string;
}

export async function listDeposits(): Promise<Deposit[]> {
  const raw = await redis.get<Deposit[]>(DEPOSITS_KEY);
  if (!raw) return [];
  return [...raw].sort((a, b) => b.depositedAt - a.depositedAt);
}

export async function addDeposit(input: {
  memberName: string;
  amount: number;
  depositedAt: number;
  memo?: string;
}): Promise<Deposit> {
  const deposit: Deposit = {
    id: crypto.randomUUID(),
    memberName: input.memberName,
    amount: input.amount,
    depositedAt: input.depositedAt,
    createdAt: Date.now(),
    memo: input.memo?.trim() || undefined,
  };
  const current = (await redis.get<Deposit[]>(DEPOSITS_KEY)) ?? [];
  const next = [deposit, ...current].slice(0, MAX_DEPOSITS);
  await redis.set(DEPOSITS_KEY, next);
  return deposit;
}

export async function deleteDeposit(id: string): Promise<Deposit | null> {
  const current = (await redis.get<Deposit[]>(DEPOSITS_KEY)) ?? [];
  const target = current.find((d) => d.id === id);
  if (!target) return null;
  const next = current.filter((d) => d.id !== id);
  await redis.set(DEPOSITS_KEY, next);
  return target;
}
