import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { forceRefreshToken } from "@/lib/kis";

const ADMIN_USER = process.env.ADMIN_USERNAME!;
const ADMIN_PASS = process.env.ADMIN_PASSWORD!;
const ADMIN_TOKEN = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString(
  "base64"
);
const CRON_SECRET = process.env.CRON_SECRET;

export const dynamic = "force-dynamic";

async function isAuthorized(req: NextRequest) {
  // Vercel Cron (Authorization: Bearer $CRON_SECRET)
  if (CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${CRON_SECRET}`) return true;
  }
  // Admin 쿠키 (수동 트리거 버튼)
  const cookieStore = await cookies();
  if (cookieStore.get("admin_token")?.value === ADMIN_TOKEN) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const token = await forceRefreshToken();
    return NextResponse.json({
      success: true,
      tokenPreview: `${token.slice(0, 8)}...${token.slice(-4)}`,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}

// Vercel Cron은 POST로도 호출될 수 있음
export const POST = GET;
