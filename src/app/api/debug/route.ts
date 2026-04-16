import { NextResponse } from "next/server";
import { getOverseasBalance } from "@/lib/kis";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const balance = await getOverseasBalance();
    return NextResponse.json(balance);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}
