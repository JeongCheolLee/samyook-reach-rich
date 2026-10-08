import { readFile, stat } from "node:fs/promises";
import { Pool } from "pg";
import { importSnapshot } from "./redis-migration-lib";
async function main() {
  const index = process.argv.indexOf("--input");
  if (index < 0 || !process.argv[index+1] || process.argv[index+1].startsWith("--") || !process.env.DATABASE_URL) throw new Error("Missing --input or DATABASE_URL");
  const file = process.argv[index+1];
  if ((await stat(file)).mode & 0o077) throw new Error("Snapshot file permissions must be 0600");
  const snapshot = JSON.parse(await readFile(file,"utf8"));
  const pool = new Pool({ connectionString:process.env.DATABASE_URL, max:1, connectionTimeoutMillis:5000 });
  try { const client=await pool.connect(); try { console.log(JSON.stringify(await importSnapshot(client,snapshot,{allowLiveRehearsal:process.argv.includes("--allow-live-rehearsal")}))); } finally { client.release(); } }
  finally { await pool.end(); }
}
main().catch(() => { console.error("Import failed; transaction rolled back. Check snapshot permissions, migrations, data validity and empty destination. Existing imports are never overwritten."); process.exitCode=1; });
