import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const ADMIN_USER = process.env.ADMIN_USERNAME!;
const ADMIN_PASS = process.env.ADMIN_PASSWORD!;
const TOKEN = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString("base64");

export async function GET() {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("admin_token");

  if (adminToken?.value === TOKEN) {
    return NextResponse.json({ authenticated: true });
  }

  return NextResponse.json({ authenticated: false }, { status: 401 });
}
