import fs from "fs";
import path from "path";
import type { Member } from "./mock-data";

const DATA_PATH = path.join(process.cwd(), "data", "members.json");

export function getMembers(): Member[] {
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  const members: Member[] = JSON.parse(raw);
  // totalContributed 내림차순 → 같으면 이름 가나다순
  return members.sort((a, b) => {
    if (b.totalContributed !== a.totalContributed) {
      return b.totalContributed - a.totalContributed;
    }
    return a.name.localeCompare(b.name, "ko");
  });
}

export function saveMembers(members: Member[]) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(members, null, 2), "utf-8");
}
