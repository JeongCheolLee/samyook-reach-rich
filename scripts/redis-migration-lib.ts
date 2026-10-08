import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

type Member = { name: string; icon: string; totalContributed: number };
type Deposit = { id: string; memberName: string; amount: number; depositedAt: number; createdAt: number; memo?: string };
type Comment = { id: string; author: string; icon: string; text: string; createdAt: number; parentId?: string | null; ip?: string | null; ua?: string | null; device?: string | null; geo?: string | null; isp?: string | null };
export type Snapshot = {
  version: 1; exportedAt: number; quiesced: boolean;
  members: Member[]; deposits: Deposit[]; comments: Comment[];
  viewsTotal: number;
  dailyViews: { day: string; count: number; expiresAt: number | null }[];
  kisToken: { token: string; expiresAt: number } | null;
};

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function stableId(value: string): string {
  const hex = digest(value).slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
}
function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`Invalid export: ${label}`);
}
const integer = (x: unknown) => Number.isSafeInteger(x);
const uuid = (x: unknown) => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const timestamp = (x: number) => integer(x) && Number.isFinite(new Date(x).getTime());

export function makePlan(snapshot: Snapshot) {
  assert(snapshot.version === 1 && typeof snapshot.quiesced === "boolean" && timestamp(snapshot.exportedAt), "version or quiescence");
  assert(Array.isArray(snapshot.members) && Array.isArray(snapshot.deposits) && Array.isArray(snapshot.comments) && Array.isArray(snapshot.dailyViews), "collections");
  assert(integer(snapshot.viewsTotal) && snapshot.viewsTotal >= 0, "total views");
  const names = new Set<string>();
  for (const m of snapshot.members) {
    assert(typeof m.name === "string" && !!m.name && typeof m.icon === "string" && integer(m.totalContributed), "member fields");
    assert(!names.has(m.name), "duplicate active member name; manual reconciliation required"); names.add(m.name);
  }
  const members = snapshot.members.map((m) => ({ id: stableId(`member:${m.name}`), name: m.name, icon: m.icon, active: true }));
  let archivedMembers = 0;
  const depositIds = new Set<string>();
  const deposits = snapshot.deposits.map((d) => {
    assert(uuid(d.id) && typeof d.memberName === "string" && !!d.memberName && integer(d.amount) && d.amount !== 0 && timestamp(d.depositedAt) && timestamp(d.createdAt) && (d.memo === undefined || typeof d.memo === "string"), "deposit fields");
    assert(!depositIds.has(d.id), "duplicate deposit ID"); depositIds.add(d.id);
    if (!names.has(d.memberName)) {
      members.push({ id: stableId(`member:${d.memberName}`), name: d.memberName, icon: "👤", active: false });
      names.add(d.memberName); archivedMembers++;
    }
    return { id: d.id, member_id: stableId(`member:${d.memberName}`), amount: d.amount, kind: "deposit", deposited_at: d.depositedAt, created_at: d.createdAt, memo: d.memo ?? null };
  });
  let openingAdjustments = 0;
  for (const m of snapshot.members) {
    const id = stableId(`member:${m.name}`);
    const known = deposits.filter((d) => d.member_id === id).reduce((sum, d) => sum + BigInt(d.amount), BigInt(0));
    const adjustment = Number(BigInt(m.totalContributed) - known);
    assert(integer(adjustment), "opening adjustment outside safe integer range");
    if (adjustment) {
      deposits.push({ id: stableId(`opening:${m.name}`), member_id: id, amount: adjustment, kind: "opening", deposited_at: snapshot.exportedAt, created_at: snapshot.exportedAt, memo: "Redis 이전 잔액 조정" });
      openingAdjustments++;
    }
  }
  const commentIds = new Set<string>();
  for (const c of snapshot.comments) {
    assert(uuid(c.id) && (c.parentId == null || uuid(c.parentId)) && timestamp(c.createdAt), "comment identifiers");
    assert([c.author,c.icon,c.text].every((x) => typeof x === "string"), "comment content fields");
    assert([c.ip,c.ua,c.device,c.geo,c.isp].every((x) => x == null || typeof x === "string"), "comment metadata fields");
    assert(!commentIds.has(c.id), "duplicate comment ID"); commentIds.add(c.id);
  }
  let orphanReplies = 0;
  const comments = snapshot.comments.map((c) => {
    const parentId = c.parentId ?? null;
    const orphan = parentId !== null && !commentIds.has(parentId);
    if (orphan) orphanReplies++;
    return { id: c.id, author: c.author, icon: c.icon, text: c.text, created_at: c.createdAt, parent_id: orphan ? null : parentId, legacy_parent_id: orphan ? parentId : null, ip: c.ip ?? null, ua: c.ua ?? null, device: c.device ?? null, geo: c.geo ?? null, isp: c.isp ?? null };
  });
  // Cycles have no meaningful reply hierarchy and must be resolved explicitly.
  const parentIds = new Map(comments.map((c) => [c.id, c.parent_id]));
  for (const c of comments) {
    const seen = new Set<string>(); let cursor: string | null = c.id;
    while (cursor) { assert(!seen.has(cursor), "comment reply cycle; manual reconciliation required"); seen.add(cursor); cursor = parentIds.get(cursor) ?? null; }
  }
  const days = new Set<string>();
  const daily = snapshot.dailyViews.map((d) => {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(d.day) && new Date(d.day).toISOString().slice(0,10) === d.day && !days.has(d.day), "daily view date");
    days.add(d.day);
    assert(integer(d.count) && d.count >= 0 && (d.expiresAt === null || timestamp(d.expiresAt)), "daily view fields");
    return { day: d.day, count: d.count, expires_at: d.expiresAt };
  });
  if (snapshot.kisToken !== null) assert(typeof snapshot.kisToken.token === "string" && !!snapshot.kisToken.token && timestamp(snapshot.kisToken.expiresAt), "KIS token fields");
  for(const member of members) {
    const total=deposits.filter((d)=>d.member_id===member.id).reduce((sum,d)=>sum+BigInt(d.amount),BigInt(0));
    assert(integer(Number(total)),"member ledger sum outside safe integer range");
  }
  const byId = <T extends { id: string }>(a:T,b:T) => a.id.localeCompare(b.id);
  members.sort(byId); deposits.sort(byId); comments.sort(byId); daily.sort((a,b) => a.day.localeCompare(b.day));
  const state = { members, deposits, comments, viewsTotal: snapshot.viewsTotal, dailyViews: daily };
  return { ...state, fingerprint: digest(snapshot), stateHash: digest(state), report: { sourceMembers: snapshot.members.length, members: members.length, sourceDeposits: snapshot.deposits.length, deposits: deposits.length, comments: comments.length, dailyViews: daily.length, viewsTotal: snapshot.viewsTotal, archivedMembers, openingAdjustments, orphanReplies, legacyRootComments:snapshot.comments.filter((c)=>c.parentId===undefined).length } };
}

export async function readDatabaseState(client: PoolClient) {
  const members = (await client.query("SELECT id,name,icon,active FROM members ORDER BY id")).rows;
  const deposits = (await client.query("SELECT id,member_id,amount,kind,(extract(epoch from deposited_at)*1000)::bigint AS deposited_at,(extract(epoch from created_at)*1000)::bigint AS created_at,memo FROM deposits ORDER BY id")).rows.map((d) => ({...d,amount:Number(d.amount),deposited_at:Number(d.deposited_at),created_at:Number(d.created_at)}));
  const comments = (await client.query("SELECT id,author,icon,text,(extract(epoch from created_at)*1000)::bigint AS created_at,parent_id,legacy_parent_id,ip,ua,device,geo,isp FROM comments ORDER BY id")).rows.map((c) => ({...c,created_at:Number(c.created_at)}));
  const views = await client.query("SELECT total FROM view_totals WHERE id=1");
  const dailyViews = (await client.query("SELECT day::text,count,(extract(epoch from expires_at)*1000)::bigint AS expires_at FROM daily_views ORDER BY day")).rows.map((d) => ({...d,count:Number(d.count),expires_at:d.expires_at === null ? null : Number(d.expires_at)}));
  return { members, deposits, comments, viewsTotal:Number(views.rows[0]?.total ?? 0), dailyViews };
}

type ImportOptions = { allowLiveRehearsal?: boolean };
async function enforceSourceMode(client:PoolClient,snapshot:Snapshot,options:ImportOptions) {
  if(snapshot.quiesced === true)return;
  if(!options.allowLiveRehearsal)throw new Error("Unquiesced source is allowed only for an explicitly flagged rehearsal");
  const result=await client.query("SELECT current_database() AS name");
  if(!/_(?:rehearsal|test)$/.test(result.rows[0].name))throw new Error("Live rehearsal requires a database name ending _rehearsal or _test");
}

export async function verifyImport(client: PoolClient, snapshot: Snapshot, options:ImportOptions = {}) {
  await enforceSourceMode(client,snapshot,options);
  const plan = makePlan(snapshot);
  const state = await readDatabaseState(client);
  const actualHash = digest(state);
  if (actualHash !== plan.stateHash) throw new Error("Database differs from export plan (content/count/total hash mismatch); no data was modified");
  let kisTokenVerified=false;
  if(snapshot.kisToken && snapshot.kisToken.expiresAt>Date.now()) {
    const stored=await client.query("SELECT token,expires_at FROM kis_tokens WHERE id=1");
    if(stored.rows[0]?.token!==snapshot.kisToken.token || new Date(stored.rows[0]?.expires_at).getTime()!==snapshot.kisToken.expiresAt)throw new Error("Unexpired KIS token differs from snapshot");
    kisTokenVerified=true;
  }
  return { ...plan.report, fingerprint:plan.fingerprint, stateHash:actualHash, verified:true, kisTokenVerified };
}

export async function importSnapshot(client: PoolClient, snapshot: Snapshot, options:ImportOptions = {}) {
  await enforceSourceMode(client,snapshot,options);
  const plan = makePlan(snapshot);
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(36190602)");
    await client.query("LOCK TABLE members,deposits,comments,view_totals,daily_views,kis_tokens,redis_import_runs IN ACCESS EXCLUSIVE MODE");
    const prior = await client.query("SELECT fingerprint,report FROM redis_import_runs WHERE id=1");
    if (prior.rows.length) {
      if (prior.rows[0].fingerprint !== plan.fingerprint) throw new Error("Destination already imported a different snapshot; refusing to overwrite");
      await client.query("COMMIT");
      return { ...prior.rows[0].report, alreadyImported:true, verified:false, verificationSkipped:true };
    }
    const occupied = await client.query("SELECT EXISTS(SELECT 1 FROM members UNION ALL SELECT 1 FROM deposits UNION ALL SELECT 1 FROM comments UNION ALL SELECT 1 FROM daily_views UNION ALL SELECT 1 FROM kis_tokens UNION ALL SELECT 1 FROM view_totals WHERE total<>0) AS occupied");
    if (occupied.rows[0].occupied) throw new Error("Destination is not empty; refusing to overwrite existing data");
    for (const m of plan.members) await client.query("INSERT INTO members(id,name,icon,active) VALUES($1,$2,$3,$4)", [m.id,m.name,m.icon,m.active]);
    for (const d of plan.deposits) await client.query("INSERT INTO deposits(id,member_id,amount,kind,deposited_at,created_at,memo) VALUES($1,$2,$3,$4,$5,$6,$7)", [d.id,d.member_id,d.amount,d.kind,new Date(d.deposited_at),new Date(d.created_at),d.memo]);
    // Two passes allow arbitrary source list order without disabling foreign keys.
    for (const c of plan.comments) await client.query("INSERT INTO comments(id,author,icon,text,created_at,legacy_parent_id,ip,ua,device,geo,isp) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [c.id,c.author,c.icon,c.text,new Date(c.created_at),c.legacy_parent_id,c.ip,c.ua,c.device,c.geo,c.isp]);
    for (const c of plan.comments) if (c.parent_id) await client.query("UPDATE comments SET parent_id=$1 WHERE id=$2", [c.parent_id,c.id]);
    await client.query("INSERT INTO view_totals(id,total) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET total=EXCLUDED.total", [plan.viewsTotal]);
    for (const d of plan.dailyViews) await client.query("INSERT INTO daily_views(day,count,expires_at) VALUES($1,$2,$3)", [d.day,d.count,d.expires_at === null ? null : new Date(d.expires_at)]);
    if (snapshot.kisToken && snapshot.kisToken.expiresAt > Date.now()) await client.query("INSERT INTO kis_tokens(id,token,expires_at,last_attempt_at) VALUES(1,$1,$2,now())", [snapshot.kisToken.token,new Date(snapshot.kisToken.expiresAt)]);
    const report = await verifyImport(client, snapshot, options);
    await client.query("INSERT INTO redis_import_runs(id,fingerprint,report) VALUES(1,$1,$2)", [plan.fingerprint,JSON.stringify(report)]);
    await client.query("COMMIT");
    return { ...report, alreadyImported:false };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
