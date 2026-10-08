import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createTokenManager } from "../src/server/kis-token";

const database=process.env.TEST_DATABASE_URL;
let pool:Pool;
before(async()=>{
  if(!database)return;
  assert.match(new URL(database).pathname,/test/);
  pool=new Pool({connectionString:database,options:"-c search_path=kis_tests",max:5});
  await pool.query("DROP SCHEMA IF EXISTS kis_tests CASCADE; CREATE SCHEMA kis_tests");
  await pool.query(await readFile("db/migrations/003_kis.sql","utf8"));
});
after(async()=>{if(pool){await pool.query("DROP SCHEMA kis_tests CASCADE");await pool.end();}});
test("separate workers issue once; late invalidation cannot remove a newer token",{skip:!database},async()=>{
  let issued=0;
  const issue=async()=>{issued++;await new Promise((r)=>setTimeout(r,50));return{token:"fixture-token",expiresAt:Date.now()+60000};};
  const managers=Array.from({length:4},()=>createTokenManager({pool,issue}));
  const values=await Promise.all(managers.flatMap((m)=>[m.get(),m.get()]));
  assert.equal(issued,1);assert.equal(new Set(values).size,1);
  await pool.query("UPDATE kis_tokens SET token='new-fixture-token'");
  await managers[0].invalidate("fixture-token");
  assert.equal((await pool.query("SELECT token FROM kis_tokens")).rows[0].token,"new-fixture-token");
});
test("failed issuance persists cooldown and releases lock on same connection",{skip:!database},async()=>{
  await pool.query("TRUNCATE kis_tokens");
  let issued=0;
  const issue=async()=>{issued++;throw new Error("fixture failure");};
  const first=createTokenManager({pool,issue});
  await assert.rejects(()=>first.get(),/fixture failure/);
  const second=createTokenManager({pool,issue});
  await assert.rejects(()=>second.get(),/cooldown/);
  assert.equal(issued,1);
  const client=await pool.connect();
  try{assert.equal((await client.query("SELECT pg_try_advisory_lock(36190601) AS ok")).rows[0].ok,true);await client.query("SELECT pg_advisory_unlock(36190601)");}finally{client.release();}
});
test("lock timeout never falls through to unguarded issuance",{skip:!database},async()=>{
  await pool.query("TRUNCATE kis_tokens");
  const owner=await pool.connect();let issued=0;
  try {
    await owner.query("SELECT pg_advisory_lock(36190601)");
    const manager=createTokenManager({pool,lockWaitMs:30,issue:async()=>{issued++;return{token:"bad",expiresAt:Date.now()+1000};}});
    await assert.rejects(()=>manager.get(),/busy/);
    assert.equal(issued,0);
  }finally{await owner.query("SELECT pg_advisory_unlock(36190601)");owner.release();}
});
