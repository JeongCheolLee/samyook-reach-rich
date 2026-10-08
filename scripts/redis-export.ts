import { open, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { makePlan, type Snapshot } from "./redis-migration-lib";

let stage="arguments";
async function main() {
  const args = process.argv.slice(2);
  const output = args[args.indexOf("--output") + 1];
  const quiesced=args.includes("--quiesced");
  const rehearsal=args.includes("--live-rehearsal");
  if (!args.includes("--output") || !output || output.startsWith("--") || quiesced === rehearsal) throw new Error("Usage: tsx scripts/redis-export.ts --output .migration/snapshot.json (--quiesced OR --live-rehearsal); quiesced requires ALL source writes and KIS calls stopped");
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Missing Redis environment variables");
  async function command(...command: (string | number)[]): Promise<unknown> {
    const response = await fetch(url!, { method:"POST", headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" }, body:JSON.stringify(command), signal:AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Redis export request failed (HTTP ${response.status})`);
    const body = await response.json();
    if (body.error) throw new Error("Redis export command failed");
    return body.result;
  }
  function decode(value:unknown) { return typeof value === "string" ? JSON.parse(value) : value; }
  const keys = new Set<string>(); let cursor = "0";
  stage="scan-daily-views";
  do {
    const result = await command("SCAN",cursor,"MATCH","views:day:*","COUNT",100) as [string,string[]];
    cursor = String(result[0]); result[1].forEach((key) => keys.add(key));
  } while(cursor !== "0");
  const exportedAt = Date.now();
  stage="read-source-records";
  const snapshot: Snapshot = {
    version:1, exportedAt, quiesced,
    members:decode(await command("GET","members:list")) ?? [],
    deposits:decode(await command("GET","deposits:list")) ?? [],
    comments:((await command("LRANGE","comments:global",0,-1)) as unknown[]).map(decode),
    viewsTotal:Number(await command("GET","views:total") ?? 0),
    dailyViews:[], kisToken:decode(await command("GET","kis:access_token")) ?? null,
  };
  stage="read-daily-expiries";
  for (const key of [...keys].sort()) {
    const before = Date.now();
    const [value, ttl] = await command("EVAL","return {redis.call('GET', KEYS[1]),redis.call('PTTL', KEYS[1])}",1,key) as [string | null,number];
    if (value === null || ttl === -2) continue;
    snapshot.dailyViews.push({ day:key.slice("views:day:".length), count:Number(value), expiresAt:ttl === -1 ? null : before + ttl });
  }
  stage="validate-snapshot";
  const plan = makePlan(snapshot);
  stage="write-private-snapshot";
  const target = resolve(output);
  await mkdir(dirname(target), { recursive:true, mode:0o700 });
  const file = await open(target,"wx",0o600);
  try { await file.writeFile(JSON.stringify(snapshot,null,2)); } finally { await file.close(); }
  console.log(JSON.stringify({ ...plan.report, fingerprint:plan.fingerprint, stateHash:plan.stateHash, exported:true, quiesced }));
}
main().catch((error) => {
  const reason=error instanceof Error && error.message.startsWith("Invalid export: ") ? error.message : "Operation failed; upstream and filesystem details suppressed";
  console.error(JSON.stringify({failed:true,stage,reason})); process.exitCode=1;
});
