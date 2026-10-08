import { NextResponse } from "next/server";
import { consumeLoginAttempt, createAdminSession, requireSameOrigin, revokeAdminSession } from "@/server/auth";
import { credentialsMatch } from "@/server/auth-core";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.username !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "아이디와 비밀번호를 입력해주세요" }, { status: 400 });
  }
  if (!(await consumeLoginAttempt())) {
    return NextResponse.json({ error: "로그인 시도가 많습니다. 15분 후 다시 시도해주세요" }, { status: 429, headers: { "Retry-After": "900" } });
  }
  if (!credentialsMatch(body.username, body.password)) {
    return NextResponse.json({ success: false, error: "아이디 또는 비밀번호가 틀렸습니다" }, { status: 401 });
  }
  await createAdminSession();
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  await revokeAdminSession();
  return NextResponse.json({ success: true });
}
