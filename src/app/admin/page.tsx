"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Member {
  id: string;
  version: number;
  name: string;
  icon: string;
  totalContributed: number;
}

interface Deposit {
  id: string;
  memberName: string;
  memberId: string;
  kind: "deposit" | "adjustment" | "opening";
  amount: number;
  depositedAt: number;
  createdAt: number;
  memo?: string;
}

const ANIMAL_ICONS = [
  "🐻", "🐯", "🦊", "🐺", "🦁", "🐧", "🐶", "🐱",
  "🐰", "🐼", "🦄", "🐸", "🐵", "🐮", "🐷", "🐹",
];

function todayLocalISO(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yy}.${mm}.${dd} ${hh}:${mi}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [members, setMembers] = useState<Member[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("🐻");

  // 입금 폼 상태
  const [depMember, setDepMember] = useState("");
  const [depAmount, setDepAmount] = useState("50000");
  const [depDate, setDepDate] = useState(todayLocalISO());
  const [depMemo, setDepMemo] = useState("");
  const [depError, setDepError] = useState("");

  useEffect(() => {
    fetch("/api/auth/check").then((r) => {
      setAuthed(r.ok);
      if (r.ok) void loadAll();
      else setLoading(false);
    }).catch(() => { setAuthed(false); setLoading(false); setLoginError("서버에 연결하지 못했습니다"); });
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [mRes, dRes] = await Promise.all([fetch("/api/members"), fetch("/api/deposits")]);
      if (!mRes.ok || !dRes.ok) throw new Error("불러오기 실패");
      const [m, d]: [Member[], Deposit[]] = await Promise.all([mRes.json(), dRes.json()]);
      setMembers(m);
      setDeposits(d);
      setDepMember((selected) => m.some((member) => member.id === selected) ? selected : m[0]?.id ?? "");
    } catch {
      setDepError("데이터를 불러오지 못했습니다. 새로고침해주세요");
    } finally { setLoading(false); }
  }

  async function login() {
    setLoginError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        setPassword(""); setAuthed(true); await loadAll();
      } else {
        const data = await res.json();
        setLoginError(data.error || "로그인 실패");
      }
    } catch { setLoginError("서버에 연결하지 못했습니다"); }
  }

  async function logout() {
    try {
      const res = await fetch("/api/auth", { method: "DELETE" });
      if (!res.ok) throw new Error("로그아웃 실패");
      setAuthed(false);
    } catch { setDepError("로그아웃에 실패했습니다. 다시 시도해주세요"); }
  }

  async function mutate(url: string, method: string, body?: unknown): Promise<boolean> {
    if (saving) return false;
    setSaving(true); setDepError("");
    try {
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) { setAuthed(false); setLoginError("다시 로그인해주세요"); }
        const stale = res.status === 409 && data.code === "stale_member";
        if (stale) await loadAll();
        setDepError(stale ? "다른 변경이 있어 최신 정보를 불러왔습니다. 확인 후 다시 저장해주세요" : data.error || "저장 실패");
        return false;
      }
      await loadAll();
      return true;
    } catch { setDepError("네트워크 오류가 발생했습니다. 새로고침 후 저장 여부를 확인해주세요"); return false; }
    finally { setSaving(false); }
  }

  async function addMember() {
    if (!newName.trim()) return;
    if (await mutate("/api/members", "PUT", { action: "create", name: newName.trim(), icon: newIcon })) setNewName("");
  }

  function removeMember(member: Member) {
    if (!confirm(`${member.name} 멤버를 삭제할까요? (입금 내역은 보존됩니다)`)) return;
    void mutate("/api/members", "PUT", { action: "archive", id: member.id, expectedVersion: member.version });
  }

  function updateContribution(member: Member, amount: number) {
    if (!Number.isSafeInteger(amount)) { setDepError("금액은 원 단위 정수로 입력해주세요"); return; }
    void mutate("/api/members", "PUT", { action: "update", id: member.id, expectedVersion: member.version, totalContributed: amount });
  }

  function updateIcon(member: Member, icon: string) {
    void mutate("/api/members", "PUT", { action: "update", id: member.id, expectedVersion: member.version, icon });
  }

  async function recordDeposit() {
    const amount = Number(depAmount);
    if (!depMember || !Number.isSafeInteger(amount) || amount === 0) { setDepError("멤버와 원 단위 금액을 확인해주세요"); return; }
    const dateMs = new Date(`${depDate}T00:00:00+09:00`).getTime();
    if (!Number.isFinite(dateMs)) { setDepError("날짜를 확인해주세요"); return; }
    if (await mutate("/api/deposits", "POST", { memberId: depMember, amount, depositedAt: dateMs, memo: depMemo })) setDepMemo("");
  }

  async function quickDeposit(memberId: string, amount: number) {
    await mutate("/api/deposits", "POST", { memberId, amount, depositedAt: Date.now() });
  }

  async function removeDeposit(id: string) {
    if (!confirm("이 기록을 삭제할까요? (해당 금액만큼 납입금이 조정됩니다)")) return;
    await mutate(`/api/deposits?id=${encodeURIComponent(id)}`, "DELETE");
  }

  if (authed === null) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted">
        확인 중...
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-full max-w-sm px-6">
          <div className="rounded-xl border border-card-border bg-card p-6">
            <div className="text-center mb-6">
              <div className="text-2xl font-black">REACH RICH</div>
              <div className="text-xs text-muted mt-1">Admin</div>
            </div>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="아이디"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && login()}
                className="h-10 px-3 rounded-lg border border-card-border bg-background text-sm"
              />
              <input
                type="password"
                placeholder="비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && login()}
                className="h-10 px-3 rounded-lg border border-card-border bg-background text-sm"
              />
              {loginError && (
                <div className="text-xs text-negative text-center">
                  {loginError}
                </div>
              )}
              <button
                onClick={login}
                className="h-10 rounded-lg bg-accent text-white text-sm font-medium"
              >
                로그인
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted">
        로딩 중...
      </div>
    );
  }

  const memberDeposits = (id: string) =>
    deposits.filter((d) => d.memberId === id);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-card-border bg-card">
        <div className="mx-auto max-w-2xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold tracking-tight">36</span>
            <span className="text-muted text-sm">Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-accent hover:underline">
              대시보드
            </Link>
            <button
              onClick={logout}
              className="text-sm text-muted hover:text-negative"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        {/* 입금 기록 폼 */}
        <h1 className="text-xl font-bold mb-4">입금 기록</h1>
        <div className="rounded-xl border border-card-border bg-card p-4 mb-8">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <select
              value={depMember}
              onChange={(e) => setDepMember(e.target.value)}
              className="h-10 px-3 rounded-lg border border-card-border bg-background text-sm"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.icon} {m.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={depDate}
              onChange={(e) => setDepDate(e.target.value)}
              className="h-10 px-3 rounded-lg border border-card-border bg-background text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={depAmount}
                onChange={(e) => setDepAmount(e.target.value)}
                step={10000}
                className="flex-1 h-10 px-3 rounded-lg border border-card-border bg-background text-sm font-mono text-right"
              />
              <span className="text-xs text-muted">원</span>
            </div>
            <input
              type="text"
              placeholder="메모 (선택)"
              value={depMemo}
              onChange={(e) => setDepMemo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && recordDeposit()}
              className="h-10 px-3 rounded-lg border border-card-border bg-background text-sm"
            />
          </div>
          {depError && (
            <div className="text-xs text-negative mb-2">{depError}</div>
          )}
          <button
            onClick={recordDeposit}
            disabled={saving}
            className="w-full h-10 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50"
          >
            기록하기
          </button>
          <p className="mt-2 text-xs text-muted">
            기록 시 해당 멤버의 납입금이 자동으로 더해집니다. 음수도 가능 (환불).
          </p>
        </div>

        {/* 입금 히스토리 */}
        <h2 className="text-base font-bold mb-3">
          최근 입금 내역 ({deposits.length}건)
        </h2>
        <div className="rounded-xl border border-card-border bg-card mb-8">
          {deposits.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">
              아직 기록된 입금 내역이 없습니다
            </div>
          ) : (
            <ul className="divide-y divide-card-border">
              {deposits.map((d) => {
                const member = members.find((m) => m.id === d.memberId);
                return (
                  <li
                    key={d.id}
                    className="px-4 py-3 flex items-center gap-3"
                  >
                    <span className="text-lg">{member?.icon ?? "👤"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {d.memberName}{d.kind !== "deposit" ? " · 잔액 조정" : ""}
                        </span>
                        <span
                          className={`text-sm font-mono ${
                            d.amount < 0 ? "text-negative" : "text-positive"
                          }`}
                        >
                          {d.amount > 0 ? "+" : ""}
                          {d.amount.toLocaleString()}원
                        </span>
                      </div>
                      <div className="text-xs text-muted mt-0.5 flex items-center gap-2">
                        <span>{formatDate(d.depositedAt)}</span>
                        {d.memo && (
                          <span className="truncate">· {d.memo}</span>
                        )}
                        <span
                          className="text-[10px] opacity-60"
                          title={`기록: ${formatDateTime(d.createdAt)}`}
                        >
                          (기록 {formatDateTime(d.createdAt)})
                        </span>
                      </div>
                    </div>
                    <button
                      disabled={saving || d.kind === "opening"}
                      onClick={() => removeDeposit(d.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-negative hover:bg-negative-bg transition-colors"
                      aria-label="삭제"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 멤버 추가 */}
        <h2 className="text-base font-bold mb-3">멤버 관리</h2>
        <div className="rounded-xl border border-card-border bg-card p-4 mb-4">
          <h3 className="text-sm font-semibold mb-3">멤버 추가</h3>
          <div className="flex gap-2">
            <select
              value={newIcon}
              onChange={(e) => setNewIcon(e.target.value)}
              className="w-14 h-10 text-center text-xl rounded-lg border border-card-border bg-background"
            >
              {ANIMAL_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="이름"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMember()}
              className="flex-1 h-10 px-3 rounded-lg border border-card-border bg-background text-sm"
            />
            <button
              onClick={addMember}
              disabled={!newName.trim() || saving}
              className="h-10 px-4 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50"
            >
              추가
            </button>
          </div>
        </div>

        {/* 멤버 리스트 */}
        <div className="rounded-xl border border-card-border bg-card">
          <div className="px-4 py-3 border-b border-card-border">
            <h3 className="text-sm font-semibold">
              멤버 ({members.length}명)
            </h3>
          </div>
          <ul className="divide-y divide-card-border">
            {members.map((m) => {
              const md = memberDeposits(m.id);
              return (
                <li key={m.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <select
                      value={m.icon}
                      disabled={saving}
                      onChange={(e) => updateIcon(m, e.target.value)}
                      className="w-10 h-8 text-center text-lg rounded border border-card-border bg-background"
                    >
                      {ANIMAL_ICONS.map((icon) => (
                        <option key={icon} value={icon}>
                          {icon}
                        </option>
                      ))}
                    </select>
                    <span className="text-sm font-medium flex-1">
                      {m.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <ContributionInput
                        key={`${m.id}:${m.version}`}
                        disabled={saving}
                        value={m.totalContributed}
                        onCommit={(v) => updateContribution(m, v)}
                      />
                      <span className="text-xs text-muted">원</span>
                      <button
                        onClick={() => quickDeposit(m.id, 50000)}
                        disabled={saving}
                        className="ml-1 h-8 px-2 rounded bg-accent text-white text-xs font-medium disabled:opacity-50"
                        title="오늘 날짜로 +5만 입금 기록"
                      >
                        +5만
                      </button>
                    </div>
                    <button
                      disabled={saving}
                      aria-label={`${m.name} 삭제`}
                      onClick={() => removeMember(m)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-negative hover:bg-negative-bg transition-colors"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  </div>
                  {md.length > 0 && (
                    <div className="mt-2 ml-13 pl-0 text-xs text-muted">
                      입금 {md.length}건 · 합계{" "}
                      {md
                        .reduce((s, d) => s + d.amount, 0)
                        .toLocaleString()}
                      원
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {saving && (
          <div className="mt-4 text-center text-sm text-muted">저장 중...</div>
        )}
      </main>
    </div>
  );
}

function ContributionInput({
  value,
  onCommit,
  disabled,
}: {
  disabled: boolean;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  function commit() {
    if (!draft.trim()) { setDraft(String(value)); return; }
    const n = Number(draft);
    if (!Number.isSafeInteger(n) || n === value) return;
    onCommit(n);
  }

  return (
    <input
      type="number"
      value={draft}
      disabled={disabled}
      aria-label="누적 납입금"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      step={1}
      className="w-28 h-8 px-2 text-right text-sm rounded border border-card-border bg-background font-mono"
    />
  );
}
