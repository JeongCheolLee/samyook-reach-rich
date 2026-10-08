import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasTrustedOrigin, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./auth-core";
import { hasActiveSession, issueSession, revokeSession } from "./auth-session-store";

export { consumeLoginAttempt } from "./auth-session-store";

export function requireSameOrigin(request: Request): NextResponse | null {
  return hasTrustedOrigin(request) ? null : NextResponse.json({ error: "허용되지 않은 요청입니다" }, { status: 403 });
}

export async function isAdmin(): Promise<boolean> {
  return hasActiveSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireAdmin(request: Request): Promise<NextResponse | null> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  return await isAdmin() ? null : NextResponse.json({ error: "관리자 로그인이 필요합니다" }, { status: 401 });
}

export async function createAdminSession(): Promise<void> {
  const store = await cookies();
  const { token, expiresAt } = await issueSession(store.get(SESSION_COOKIE)?.value);
  store.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS, expires: expiresAt,
  });
  store.delete("admin_token");
}

export async function revokeAdminSession(): Promise<void> {
  const store = await cookies();
  await revokeSession(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  store.delete("admin_token");
}
