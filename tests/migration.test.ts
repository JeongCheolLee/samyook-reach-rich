import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { importSnapshot, makePlan, verifyImport, type Snapshot } from "../scripts/redis-migration-lib";

const now = 1_790_000_000_000;
const id = (digit:number) => `00000000-0000-4000-8000-${String(digit).padStart(12,"0")}`;
export const fixture: Snapshot = {
  version:1, exportedAt:now, quiesced:true,
  members:[{name:"current",icon:"🌱",totalContributed:100},{name:"negative opening",icon:"🌱",totalContributed:5}],
  deposits:[{id:id(1),memberName:"current",amount:40,depositedAt:now-1000,createdAt:now},{id:id(2),memberName:"deleted member",amount:20,depositedAt:now,createdAt:now},{id:id(3),memberName:"negative opening",amount:10,depositedAt:now,createdAt:now}],
  comments:[{id:id(4),author:"writer",icon:"🌱",text:"fixture only",createdAt:now,parentId:id(5),ip:null,ua:null,device:null,geo:null,isp:null},{id:id(5),author:"writer",icon:"🌱",text:"parent",createdAt:now-100,parentId:null,ip:null,ua:null,device:null,geo:null,isp:null},{id:id(6),author:"writer",icon:"🌱",text:"orphan preserved",createdAt:now,parentId:id(99),ip:null,ua:null,device:null,geo:null,isp:null}],
  viewsTotal:10000, dailyViews:[{day:"2026-09-20",count:3,expiresAt:now+86400000},{day:"2026-09-21",count:4,expiresAt:null}],kisToken:{token:"fixture-migration-token",expiresAt:Date.now()+3600000},
};

test("migration plan preserves financial totals, inactive history, orphan IDs and day TTL", () => {
  const plan=makePlan(fixture);
  assert.equal(plan.report.archivedMembers,1);
  assert.equal(plan.report.orphanReplies,1);
  assert.equal(plan.report.openingAdjustments,2);
  assert.equal(plan.deposits.find((d)=>d.kind==="opening" && d.amount<0)?.amount,-5);
  for(const member of fixture.members) {
    const m=plan.members.find((m)=>m.name===member.name)!;
    assert.equal(plan.deposits.filter((d)=>d.member_id===m.id).reduce((sum,d)=>sum+d.amount,0),member.totalContributed);
  }
  assert.equal(plan.comments.find((c)=>c.id===id(6))?.legacy_parent_id,id(99));
  assert.equal(plan.dailyViews[0].expires_at,now+86400000);
  assert.equal(plan.viewsTotal,10000);
});
test("duplicate member identity, corrupt amounts and reply cycles abort before writes", () => {
  assert.throws(()=>makePlan({...fixture,members:[fixture.members[0],fixture.members[0]]}),/duplicate/);
  assert.throws(()=>makePlan({...fixture,deposits:[{...fixture.deposits[0],amount:1.5}]}),/deposit/);
  assert.throws(()=>makePlan({...fixture,comments:[{...fixture.comments[0],parentId:id(4)}]}),/cycle/);
});
test("legacy negative deposits and balances retain exact signed integer amounts",()=>{
  const plan=makePlan({...fixture,members:[{name:"current",icon:"🌱",totalContributed:-10}],deposits:[{...fixture.deposits[0],amount:-5}]});
  assert.deepEqual(plan.deposits.map((d)=>d.amount),[-5,-5]);
  const large=Number.MAX_SAFE_INTEGER;
  const balanced=makePlan({...fixture,members:[{name:"current",icon:"🌱",totalContributed:1}],deposits:[{...fixture.deposits[0],amount:large},{...fixture.deposits[0],id:id(7),amount:large},{...fixture.deposits[0],id:id(8),amount:-large},{...fixture.deposits[0],id:id(9),amount:-large}]});
  assert.equal(balanced.deposits.find((d)=>d.kind==="opening")?.amount,1);
});
test("legacy comments without reply or connection fields remain root comments",()=>{
  const plan=makePlan({...fixture,comments:[{id:id(4),author:"legacy",icon:"🌱",text:"legacy fixture",createdAt:now}]});
  assert.equal(plan.comments[0].parent_id,null);
  assert.equal(plan.comments[0].ip,null);
  assert.equal(plan.report.legacyRootComments,1);
});

const database=process.env.TEST_DATABASE_URL;
let pool:Pool;
before(async()=>{
  if(!database)return;
  assert.match(new URL(database).pathname,/test/);
  pool=new Pool({connectionString:database,options:"-c search_path=migration_tests",max:2});
  await pool.query("DROP SCHEMA IF EXISTS migration_tests CASCADE; CREATE SCHEMA migration_tests");
  for(const name of ["001_core.sql","003_kis.sql"])await pool.query(await readFile(`db/migrations/${name}`,"utf8"));
});
after(async()=>{if(pool){await pool.query("DROP SCHEMA migration_tests CASCADE");await pool.end();}});
test("real PostgreSQL import verifies every retained field and refuses destructive reruns",{skip:!database},async()=>{
  const client=await pool.connect();
  try {
    const report=await importSnapshot(client,fixture);
    assert.equal(report.verified,true);
    assert.equal(report.kisTokenVerified,true);
    assert.equal((await verifyImport(client,fixture)).verified,true);
    assert.equal((await importSnapshot(client,fixture)).alreadyImported,true);
    await client.query("UPDATE view_totals SET total=total+1");
    assert.equal((await importSnapshot(client,fixture)).alreadyImported,true);
    assert.equal(Number((await client.query("SELECT total FROM view_totals")).rows[0].total),10001);
    await assert.rejects(()=>verifyImport(client,fixture),/hash mismatch/);
    await assert.rejects(()=>importSnapshot(client,{...fixture,exportedAt:now+1}),/different snapshot/);
  }finally{client.release();}
});
test("nonempty destinations are rejected without mutation",{skip:!database},async()=>{
  const client=await pool.connect();
  try {
    await client.query("TRUNCATE redis_import_runs");
    await assert.rejects(()=>importSnapshot(client,fixture),/not empty/);
    assert.equal(Number((await client.query("SELECT total FROM view_totals")).rows[0].total),10001);
  }finally{client.release();}
});
test("live rehearsal sources require explicit opt-in even on a test database",{skip:!database},async()=>{
  const client=await pool.connect();
  try {
    await assert.rejects(()=>importSnapshot(client,{...fixture,quiesced:false}),/explicitly flagged rehearsal/);
    await assert.rejects(()=>importSnapshot(client,{...fixture,quiesced:false},{allowLiveRehearsal:true}),/not empty/);
  }finally{client.release();}
});
