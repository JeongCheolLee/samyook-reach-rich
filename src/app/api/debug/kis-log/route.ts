import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getTokenDiagnostics, clearTokenLog } from "@/lib/kis";

const ADMIN_USER = process.env.ADMIN_USERNAME!;
const ADMIN_PASS = process.env.ADMIN_PASSWORD!;
const TOKEN = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString("base64");

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const cookieStore = await cookies();
  return cookieStore.get("admin_token")?.value === TOKEN;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const diag = await getTokenDiagnostics();
  return NextResponse.json(diag);
}

export async function DELETE() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await clearTokenLog();
  return NextResponse.json({ success: true });
}
