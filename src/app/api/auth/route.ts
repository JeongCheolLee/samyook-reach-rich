import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const ADMIN_USER = process.env.ADMIN_USERNAME!;
const ADMIN_PASS = process.env.ADMIN_PASSWORD!;
const TOKEN = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString("base64");

export async function POST(request: Request) {
  const { username, password } = await request.json();

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const cookieStore = await cookies();
    cookieStore.set("admin_token", TOKEN, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7일
      path: "/",
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { success: false, error: "아이디 또는 비밀번호가 틀렸습니다" },
    { status: 401 }
  );
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete("admin_token");
  return NextResponse.json({ success: true });
}
