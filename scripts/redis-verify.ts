import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { verifyImport } from "./redis-migration-lib";
async function main() {
  const index=process.argv.indexOf("--input");
  if(index<0 || !process.argv[index+1] || process.argv[index+1].startsWith("--") || !process.env.DATABASE_URL) throw new Error("Missing --input or DATABASE_URL");
  const snapshot=JSON.parse(await readFile(process.argv[index+1],"utf8"));
  const pool=new Pool({ connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000 });
  try { const client=await pool.connect(); try { await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); console.log(JSON.stringify(await verifyImport(client,snapshot,{allowLiveRehearsal:process.argv.includes("--allow-live-rehearsal")}))); await client.query("COMMIT"); } finally { client.release(); } }
  finally { await pool.end(); }
}
main().catch(() => { console.error("Verification failed: destination differs from snapshot or cannot be read. No data modified; sensitive row contents suppressed."); process.exitCode=1; });
