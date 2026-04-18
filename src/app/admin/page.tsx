"use client";

import { useState, useEffect } from "react";

interface Member {
  name: string;
  icon: string;
  totalContributed: number;
}

const ANIMAL_ICONS = [
  "🐻", "🐯", "🦊", "🐺", "🦁", "🐧", "🐶", "🐱",
  "🐰", "🐼", "🦄", "🐸", "🐵", "🐮", "🐷", "🐹",
];

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("🐻");

  // 인증 확인
  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => {
        setAuthed(r.ok);
        if (r.ok) loadMembers();
        else setLoading(false);
      });
  }, []);

  function loadMembers() {
    fetch("/api/members")
      .then((r) => r.json())
      .then((data) => {
        setMembers(data);
        setLoading(false);
      });
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
      setLoading(true);
      loadMembers();
    } else {
      setLoginError("아이디 또는 비밀번호가 틀렸습니다");
    }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    setAuthed(false);
  }

  async function save(updated: Member[]) {
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
    save([
      ...members,
      { name: newName.trim(), icon: newIcon, totalContributed: 0 },
    ]);
    setNewName("");
  }

  function removeMember(name: string) {
    save(members.filter((m) => m.name !== name));
  }

  function updateContribution(name: string, amount: number) {
    save(
      members.map((m) =>
        m.name === name ? { ...m, totalContributed: amount } : m
      )
    );
  }

  function updateIcon(name: string, icon: string) {
    save(
      members.map((m) => (m.name === name ? { ...m, icon } : m))
    );
  }

  // 로딩 중
  if (authed === null) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted">
        확인 중...
      </div>
    );
  }

  // 로그인 화면
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

  // 멤버 로딩 중
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted">
        로딩 중...
      </div>
    );
  }

  // 어드민 메인
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
            <a
              href="/admin/kis-log"
              className="text-sm text-accent hover:underline"
            >
              토큰로그
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
        <h1 className="text-xl font-bold mb-6">멤버 관리</h1>

        {/* 멤버 추가 */}
        <div className="rounded-xl border border-card-border bg-card p-4 mb-6">
          <h2 className="text-sm font-semibold mb-3">멤버 추가</h2>
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
            <h2 className="text-sm font-semibold">
              멤버 ({members.length}명)
            </h2>
          </div>
          <ul className="divide-y divide-card-border">
            {members.map((m) => (
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
                  <span className="text-sm font-medium flex-1">{m.name}</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={m.totalContributed}
                      onChange={(e) =>
                        updateContribution(m.name, Number(e.target.value))
                      }
                      step={50000}
                      className="w-28 h-8 px-2 text-right text-sm rounded border border-card-border bg-background font-mono"
                    />
                    <span className="text-xs text-muted">원</span>
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
              </li>
            ))}
          </ul>
        </div>

        {saving && (
          <div className="mt-4 text-center text-sm text-muted">저장 중...</div>
        )}
      </main>
    </div>
  );
}
