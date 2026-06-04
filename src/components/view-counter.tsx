"use client";

import { useEffect, useRef, useState } from "react";

interface ViewCounts {
  total: number;
  today: number;
}

export function ViewCounter() {
  const [counts, setCounts] = useState<ViewCounts | null>(null);
  const bumped = useRef(false);

  useEffect(() => {
    // StrictMode 이중 호출 방지 — 방문당 1회만 집계
    if (bumped.current) return;
    bumped.current = true;
    fetch("/api/views", { method: "POST" })
      .then((r) => r.json())
      .then(setCounts)
      .catch(() => {});
  }, []);

  if (!counts) return null;

  return (
    <span className="text-xs text-muted whitespace-nowrap">
      오늘 {counts.today.toLocaleString()} · 누적{" "}
      {counts.total.toLocaleString()}
    </span>
  );
}
