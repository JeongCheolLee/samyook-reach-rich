import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";
import type { Member } from "./mock-data";

const MEMBERS_KEY = "members:list";
const SEED_PATH = path.join(process.cwd(), "data", "members.json");

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

function sortMembers(members: Member[]): Member[] {
  return [...members].sort((a, b) => {
    if (b.totalContributed !== a.totalContributed) {
      return b.totalContributed - a.totalContributed;
    }
    return a.name.localeCompare(b.name, "ko");
  });
}

async function seedFromFile(): Promise<Member[]> {
  try {
    const raw = fs.readFileSync(SEED_PATH, "utf-8");
    const seed: Member[] = JSON.parse(raw);
    await redis.set(MEMBERS_KEY, seed);
    return seed;
  } catch {
    return [];
  }
}

export async function getMembers(): Promise<Member[]> {
  let members = await redis.get<Member[]>(MEMBERS_KEY);
  if (!members || members.length === 0) {
    members = await seedFromFile();
  }
  return sortMembers(members);
}

export async function saveMembers(members: Member[]): Promise<void> {
  await redis.set(MEMBERS_KEY, members);
}
