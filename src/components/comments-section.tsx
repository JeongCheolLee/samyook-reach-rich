"use client";

import { useEffect, useMemo, useState } from "react";
import type { Member } from "@/lib/mock-data";

interface Comment {
  id: string;
  author: string;
  icon: string;
  text: string;
  createdAt: number;
  parentId: string | null;
  ip: string | null;
  ua: string | null;
  device: string | null;
  geo: string | null;
  isp: string | null;
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

// 접속 정보 라벨: "iPhone · Safari · Seoul · KT" (없는 값은 생략)
function accessInfo(c: Comment): string {
  return [c.device, c.geo, c.isp].filter(Boolean).join(" · ");
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

  // 답글 영역 펼침 상태 (기본: 접힘). 펼치면 답글 목록 + 입력창이 함께 노출.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 답글 입력 초안 (댓글 id별로 분리 — 여러 개 펼쳐도 섞이지 않게)
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyAuthors, setReplyAuthors] = useState<Record<string, string>>({});

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // 펼칠 때 답글 작성자 기본값 세팅(아직 없으면)
        setReplyAuthors((a) =>
          a[id] ? a : { ...a, [id]: author || members[0]?.name || "" }
        );
      }
      return next;
    });
  }

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

  // 부모(최상위) 댓글: 최신순 유지. 답글: 부모별로 묶어 오래된 순.
  const { roots, repliesByParent } = useMemo(() => {
    const roots: Comment[] = [];
    const repliesByParent = new Map<string, Comment[]>();
    for (const c of comments) {
      if (c.parentId) {
        const arr = repliesByParent.get(c.parentId) ?? [];
        arr.push(c);
        repliesByParent.set(c.parentId, arr);
      } else {
        roots.push(c);
      }
    }
    for (const arr of repliesByParent.values()) {
      arr.sort((a, b) => a.createdAt - b.createdAt);
    }
    return { roots, repliesByParent };
  }, [comments]);

  async function submit(parentId: string | null) {
    const who =
      parentId === null
        ? author
        : replyAuthors[parentId] || author || members[0]?.name || "";
    const raw = parentId === null ? text : replyDrafts[parentId] ?? "";
    const trimmed = raw.trim();
    if (!who || !trimmed || posting) return;
    setPosting(true);
    setError("");
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: who, text: trimmed, parentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "등록 실패");
        return;
      }
      setComments((prev) => [data, ...prev]);
      if (parentId === null) {
        setText("");
      } else {
        // 초안만 비우고 펼친 상태 유지 → 방금 단 답글이 바로 보임
        setReplyDrafts((d) => ({ ...d, [parentId]: "" }));
        setExpanded((prev) => new Set(prev).add(parentId));
      }
    } catch {
      setError("네트워크 오류");
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("삭제할까요? (답글도 함께 삭제돼요)")) return;
    const res = await fetch(`/api/comments?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setComments((prev) => prev.filter((c) => c.id !== id && c.parentId !== id));
    }
  }

  function renderMeta(c: Comment) {
    const info = accessInfo(c);
    return (
      <span className="text-xs text-muted">
        {formatTime(c.createdAt)}
        {info && (
          <span className="ml-2 opacity-70">{info}</span>
        )}
        {c.ip && (
          <span className="ml-2 opacity-50 tabular-nums">{c.ip}</span>
        )}
      </span>
    );
  }

  return (
    <section className="rounded-xl border border-card-border bg-card">
      <div className="px-6 py-4 border-b border-card-border flex items-center justify-between">
        <h2 className="font-semibold">방명록</h2>
        <span className="text-xs text-muted">{roots.length}개</span>
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
                submit(null);
              }
            }}
            maxLength={MAX_LEN}
            className="flex-1 h-10 px-3 rounded-lg border border-card-border bg-background text-sm"
          />
          <button
            onClick={() => submit(null)}
            disabled={!author || !text.trim() || posting}
            className="h-10 px-4 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50"
          >
            {posting ? "..." : "등록"}
          </button>
        </div>
        <div className="text-xs text-muted opacity-70">
          작성 시 접속 기기·지역·통신사가 함께 표시돼요
        </div>
        {error && <div className="text-xs text-negative">{error}</div>}
      </div>

      {loading ? (
        <div className="px-6 py-8 text-center text-sm text-muted">로딩 중...</div>
      ) : roots.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-muted">
          첫 댓글을 남겨보세요 💬
        </div>
      ) : (
        <ul className="divide-y divide-card-border">
          {roots.map((c) => {
            const replies = repliesByParent.get(c.id) ?? [];
            return (
              <li key={c.id} className="px-6 py-3">
                <div className="flex items-start gap-3">
                  <span className="text-lg leading-none mt-0.5">{c.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-medium">{c.author}</span>
                      {renderMeta(c)}
                    </div>
                    <div className="text-sm whitespace-pre-wrap break-words">
                      {c.text}
                    </div>
                    <button
                      onClick={() => toggleExpanded(c.id)}
                      className="mt-1 text-xs text-muted hover:text-accent"
                    >
                      {expanded.has(c.id)
                        ? "답글 숨기기"
                        : replies.length > 0
                        ? `답글 ${replies.length}개 보기`
                        : "답글달기"}
                    </button>
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
                </div>

                {/* 펼치면 답글 목록 + 입력창이 함께 노출 */}
                {expanded.has(c.id) && (
                  <div className="mt-2 ml-8 pl-3 border-l border-card-border flex flex-col gap-2">
                    {replies.map((r) => (
                      <div key={r.id} className="flex items-start gap-2">
                        <span className="text-base leading-none mt-0.5">
                          {r.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="text-sm font-medium">
                              {r.author}
                            </span>
                            {renderMeta(r)}
                          </div>
                          <div className="text-sm whitespace-pre-wrap break-words">
                            {r.text}
                          </div>
                        </div>
                        {isAdmin && (
                          <button
                            onClick={() => remove(r.id)}
                            className="text-xs text-muted hover:text-negative shrink-0"
                            aria-label="삭제"
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    ))}

                    {/* 답글 입력창 */}
                    <div className="flex gap-2 pt-1">
                      <select
                        value={replyAuthors[c.id] ?? ""}
                        onChange={(e) =>
                          setReplyAuthors((a) => ({ ...a, [c.id]: e.target.value }))
                        }
                        disabled={members.length === 0}
                        className="h-9 px-2 rounded-lg border border-card-border bg-background text-sm"
                      >
                        {members.map((m) => (
                          <option key={m.name} value={m.name}>
                            {m.icon} {m.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder={`${c.author}에게 답글...`}
                        value={replyDrafts[c.id] ?? ""}
                        onChange={(e) =>
                          setReplyDrafts((d) => ({ ...d, [c.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            submit(c.id);
                          }
                        }}
                        maxLength={MAX_LEN}
                        className="flex-1 h-9 px-3 rounded-lg border border-card-border bg-background text-sm"
                      />
                      <button
                        onClick={() => submit(c.id)}
                        disabled={
                          !(replyAuthors[c.id] || members[0]?.name) ||
                          !(replyDrafts[c.id] ?? "").trim() ||
                          posting
                        }
                        className="h-9 px-3 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50"
                      >
                        {posting ? "..." : "답글"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="px-6 py-3 border-t border-card-border text-[11px] text-muted opacity-60">
        접속 지역·통신사는 IP 기반 추정치라 실제와 다를 수 있어요
      </div>
    </section>
  );
}
