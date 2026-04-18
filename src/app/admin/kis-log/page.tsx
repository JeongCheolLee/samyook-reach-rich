"use client";

import { useCallback, useEffect, useState } from "react";

type LogEvent = { ts: number; msg: string };

type Diagnostics = {
  memory: {
    hasToken: boolean;
    expiresAt?: number;
    remainingMs?: number;
  };
  blob: {
    hasToken: boolean;
    expiresAt?: number;
    remainingMs?: number;
    uploadedAt?: string;
    url?: string;
    error?: string;
  };
  events: LogEvent[];
};

function fmtTs(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDuration(ms: number | undefined) {
  if (ms == null) return "-";
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600_000);
  const m = Math.floor((abs % 3600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  return `${sign}${h}h ${m}m ${s}s`;
}

export default function KisLogPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/debug/kis-log", { cache: "no-store" });
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      if (!res.ok) {
        setErr(`API ${res.status}`);
        return;
      }
      const json = (await res.json()) as Diagnostics;
      setData(json);
      setAuthed(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function clearLog() {
    if (!confirm("로그를 모두 지울까요?")) return;
    await fetch("/api/debug/kis-log", { method: "DELETE" });
    load();
  }

  async function forceRefresh() {
    if (!confirm("KIS 토큰을 지금 강제로 새로 받을까요?")) return;
    setRefreshing(true);
    setRefreshMsg("");
    try {
      const res = await fetch("/api/cron/refresh-token");
      const json = await res.json();
      if (json.success) {
        setRefreshMsg(`OK · ${json.tokenPreview}`);
      } else {
        setRefreshMsg(`실패: ${json.error}`);
      }
    } catch (e) {
      setRefreshMsg(`에러: ${(e as Error).message}`);
    } finally {
      setRefreshing(false);
      load();
    }
  }

  async function copyAll() {
    if (!data) return;
    const header = [
      `# KIS Token Diagnostics (${new Date().toISOString()})`,
      `memory: ${JSON.stringify(data.memory)}`,
      `blob:   ${JSON.stringify(data.blob)}`,
      "",
      "# Events (oldest → newest)",
    ].join("\n");
    const body = data.events
      .map((e) => `${fmtTs(e.ts)}  ${e.msg}`)
      .join("\n");
    const text = `${header}\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 API 실패 시 대체: 텍스트 선택용 textarea 띄우기
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        alert("복사 실패 - 수동으로 선택하세요");
      }
      document.body.removeChild(ta);
    }
  }

  if (authed === false) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted">
        <div className="text-center">
          <div className="mb-3">로그인이 필요합니다</div>
          <a href="/admin" className="text-accent text-sm hover:underline">
            /admin 에서 로그인
          </a>
        </div>
      </div>
    );
  }

  if (authed === null && !data) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted">
        확인 중...
      </div>
    );
  }

  const reversed = data ? [...data.events].reverse() : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-card-border bg-card sticky top-0 z-10">
        <div className="mx-auto max-w-2xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">KIS Token Log</span>
          </div>
          <div className="flex items-center gap-2">
            <a href="/admin" className="text-xs text-accent hover:underline">
              Admin
            </a>
            <button
              onClick={load}
              disabled={loading}
              className="h-8 px-3 rounded-lg border border-card-border text-xs disabled:opacity-50"
            >
              {loading ? "..." : "새로고침"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-4">
        {err && (
          <div className="mb-3 text-xs text-negative">에러: {err}</div>
        )}

        {data && (
          <>
            <section className="rounded-xl border border-card-border bg-card p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold">현재 상태</div>
                <button
                  onClick={forceRefresh}
                  disabled={refreshing}
                  className="h-8 px-3 rounded-lg bg-accent text-white text-xs font-medium disabled:opacity-50"
                >
                  {refreshing ? "갱신 중..." : "토큰 즉시 갱신"}
                </button>
              </div>
              {refreshMsg && (
                <div className="mb-3 text-xs font-mono text-muted break-all">
                  {refreshMsg}
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 text-xs font-mono">
                <div className="flex justify-between gap-2">
                  <span className="text-muted">memory.hasToken</span>
                  <span>{String(data.memory.hasToken)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted">memory.remaining</span>
                  <span>{fmtDuration(data.memory.remainingMs)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted">blob.hasToken</span>
                  <span>{String(data.blob.hasToken)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted">blob.remaining</span>
                  <span>{fmtDuration(data.blob.remainingMs)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted">blob.uploadedAt</span>
                  <span className="text-right break-all">
                    {data.blob.uploadedAt || "-"}
                  </span>
                </div>
                {data.blob.error && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">blob.error</span>
                    <span className="text-negative break-all">
                      {data.blob.error}
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-card-border bg-card mb-4 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-card-border">
                <div className="text-sm font-semibold">
                  이벤트 ({data.events.length})
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={copyAll}
                    className="h-8 px-3 rounded-lg bg-accent text-white text-xs font-medium"
                  >
                    {copied ? "복사됨" : "전체 복사"}
                  </button>
                  <button
                    onClick={clearLog}
                    className="h-8 px-3 rounded-lg border border-card-border text-xs text-negative"
                  >
                    비우기
                  </button>
                </div>
              </div>
              {reversed.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted">
                  로그 없음
                </div>
              ) : (
                <ul className="divide-y divide-card-border">
                  {reversed.map((e, i) => (
                    <li
                      key={`${e.ts}-${i}`}
                      className="px-4 py-2 text-xs font-mono"
                    >
                      <div className="text-muted">{fmtTs(e.ts)}</div>
                      <div className="break-all">{e.msg}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
