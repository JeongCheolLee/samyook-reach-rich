"use client";

import { useState, useEffect } from "react";

interface Member {
  name: string;
  icon: string;
  totalContributed: number;
}

interface Deposit {
  id: string;
  memberName: string;
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
      if (r.ok) loadAll();
      else setLoading(false);
    });
  }, []);

  async function loadAll() {
    setLoading(true);
    const [mRes, dRes] = await Promise.all([
      fetch("/api/members"),
      fetch("/api/deposits"),
    ]);
    const [m, d] = await Promise.all([mRes.json(), dRes.json()]);
    setMembers(m);
    setDeposits(d);
    if (m.length > 0 && !depMember) setDepMember(m[0].name);
    setLoading(false);
  }

  async function login() {
    setLoginError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      setAuthed(true);
      loadAll();
    } else {
      setLoginError("아이디 또는 비밀번호가 틀렸습니다");
    }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    setAuthed(false);
  }

  async function saveMembers(updated: Member[]) {
    setSaving(true);
    const res = await fetch("/api/members", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    const data = await res.json();
    setMembers(data);
    setSaving(false);
  }

  function addMember() {
    if (!newName.trim()) return;
    saveMembers([
      ...members,
      { name: newName.trim(), icon: newIcon, totalContributed: 0 },
    ]);
    setNewName("");
  }

  function removeMember(name: string) {
    if (!confirm(`${name} 멤버를 삭제할까요? (입금 내역은 보존됩니다)`)) return;
    saveMembers(members.filter((m) => m.name !== name));
  }

  function updateContribution(name: string, amount: number) {
    saveMembers(
      members.map((m) =>
        m.name === name ? { ...m, totalContributed: amount } : m
      )
    );
  }

  function updateIcon(name: string, icon: string) {
    saveMembers(members.map((m) => (m.name === name ? { ...m, icon } : m)));
  }

  async function recordDeposit() {
    setDepError("");
    if (!depMember) {
      setDepError("멤버를 선택해주세요");
      return;
    }
    const amount = Number(depAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      setDepError("금액을 확인해주세요");
      return;
    }
    const dateMs = new Date(`${depDate}T00:00:00`).getTime();
    if (!Number.isFinite(dateMs)) {
      setDepError("날짜를 확인해주세요");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/deposits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberName: depMember,
        amount,
        depositedAt: dateMs,
        memo: depMemo,
      }),
    });
    if (!res.ok) {
      setDepError("저장 실패");
      setSaving(false);
      return;
    }
    const data = await res.json();
    setDeposits(data.deposits);
    setMembers(data.members);
    setDepMemo("");
    setSaving(false);
  }

  async function quickDeposit(memberName: string, amount: number) {
    setSaving(true);
    const res = await fetch("/api/deposits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberName,
        amount,
        depositedAt: Date.now(),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setDeposits(data.deposits);
      setMembers(data.members);
    }
    setSaving(false);
  }

  async function removeDeposit(id: string) {
    if (!confirm("이 입금 기록을 삭제할까요? (납입금이 차감됩니다)")) return;
    setSaving(true);
    const res = await fetch(`/api/deposits?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      const data = await res.json();
      setDeposits(data.deposits);
      setMembers(data.members);
    }
    setSaving(false);
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

  const memberDeposits = (name: string) =>
    deposits.filter((d) => d.memberName === name);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-card-border bg-card">
        <div className="mx-auto max-w-2xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold tracking-tight">36</span>
            <span className="text-muted text-sm">Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/" className="text-sm text-accent hover:underline">
              대시보드
            </a>
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
                <option key={m.name} value={m.name}>
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
                const member = members.find((m) => m.name === d.memberName);
                return (
                  <li
                    key={d.id}
                    className="px-4 py-3 flex items-center gap-3"
                  >
                    <span className="text-lg">{member?.icon ?? "👤"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {d.memberName}
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
              const md = memberDeposits(m.name);
              return (
                <li key={m.name} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <select
                      value={m.icon}
                      onChange={(e) => updateIcon(m.name, e.target.value)}
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
                        value={m.totalContributed}
                        onCommit={(v) => updateContribution(m.name, v)}
                      />
                      <span className="text-xs text-muted">원</span>
                      <button
                        onClick={() => quickDeposit(m.name, 50000)}
                        disabled={saving}
                        className="ml-1 h-8 px-2 rounded bg-accent text-white text-xs font-medium disabled:opacity-50"
                        title="오늘 날짜로 +5만 입금 기록"
                      >
                        +5만
                      </button>
                    </div>
                    <button
                      onClick={() => removeMember(m.name)}
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
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const n = Number(draft);
    if (!Number.isFinite(n) || n === value) return;
    onCommit(n);
  }

  return (
    <input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      step={50000}
      className="w-28 h-8 px-2 text-right text-sm rounded border border-card-border bg-background font-mono"
    />
  );
}
