import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function validSessionToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function credentialsMatch(username: unknown, password: unknown): boolean {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPass = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPass || typeof username !== "string" || typeof password !== "string") return false;
  if (username.length > 512 || password.length > 4096) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  // Evaluate both comparisons even when the username is wrong.
  const userMatches = timingSafeEqual(digest(username), digest(expectedUser));
  const passMatches = timingSafeEqual(digest(password), digest(expectedPass));
  return userMatches && passMatches;
}

export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  const configured = process.env.APP_URL;
  if (!configured && process.env.NODE_ENV === "production") return false;
  try {
    return origin === new URL(configured || request.url).origin;
  } catch {
    return false;
  }
}
