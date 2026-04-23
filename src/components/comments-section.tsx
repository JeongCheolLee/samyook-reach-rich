"use client";

import { useEffect, useState } from "react";
import type { Member } from "@/lib/mock-data";

interface Comment {
  id: string;
  author: string;
  icon: string;
  text: string;
  createdAt: number;
}

const MAX_LEN = 500;

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function CommentsSection() {
  const [members, setMembers] = useState<Member[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/members").then((r) => r.json()),
      fetch("/api/comments").then((r) => r.json()),
      fetch("/api/auth/check").then((r) => r.ok).catch(() => false),
    ])
      .then(([m, c, admin]) => {
        if (!alive) return;
        setMembers(m);
        setComments(c);
        setIsAdmin(admin);
        if (m.length > 0) setAuthor((prev) => prev || m[0].name);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError("불러오기 실패");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function submit() {
    const trimmed = text.trim();
    if (!author || !trimmed || posting) return;
    setPosting(true);
    setError("");
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author, text: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "등록 실패");
        return;
      }
      setComments((prev) => [data, ...prev]);
      setText("");
    } catch {
      setError("네트워크 오류");
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("삭제할까요?")) return;
    const res = await fetch(`/api/comments?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setComments((prev) => prev.filter((c) => c.id !== id));
    }
  }

  return (
    <section className="rounded-xl border border-card-border bg-card">
      <div className="px-6 py-4 border-b border-card-border flex items-center justify-between">
        <h2 className="font-semibold">방명록</h2>
        <span className="text-xs text-muted">{comments.length}개</span>
      </div>

      <div className="px-6 py-4 border-b border-card-border flex flex-col gap-2">
        <div className="flex gap-2">
          <select
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            disabled={loading || members.length === 0}
            className="h-10 px-2 rounded-lg border border-card-border bg-background text-sm"
          >
            {members.map((m) => (
              <option key={m.name} value={m.name}>
                {m.icon} {m.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="한 마디..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            maxLength={MAX_LEN}
            className="flex-1 h-10 px-3 rounded-lg border border-card-border bg-background text-sm"
          />
          <button
            onClick={submit}
            disabled={!author || !text.trim() || posting}
            className="h-10 px-4 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50"
          >
            {posting ? "..." : "등록"}
          </button>
        </div>
        {error && <div className="text-xs text-negative">{error}</div>}
      </div>

      {loading ? (
        <div className="px-6 py-8 text-center text-sm text-muted">로딩 중...</div>
      ) : comments.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-muted">
          첫 댓글을 남겨보세요 💬
        </div>
      ) : (
        <ul className="divide-y divide-card-border">
          {comments.map((c) => (
            <li key={c.id} className="px-6 py-3 flex items-start gap-3">
              <span className="text-lg leading-none mt-0.5">{c.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium">{c.author}</span>
                  <span className="text-xs text-muted">
                    {formatTime(c.createdAt)}
                  </span>
                </div>
                <div className="text-sm whitespace-pre-wrap break-words">
                  {c.text}
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => remove(c.id)}
                  className="text-xs text-muted hover:text-negative shrink-0"
                  aria-label="삭제"
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
