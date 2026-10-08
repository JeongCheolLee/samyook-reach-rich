import { NextResponse } from "next/server";
import { DomainError } from "@/lib/members";

export function apiError(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  // Internal database details must not be returned to clients.
  console.error("API operation failed", error instanceof Error ? error.name : "unknown");
  return NextResponse.json({ error: "요청을 처리하지 못했습니다" }, { status: 500 });
}

export const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
