import { NextResponse } from "next/server";
import { getDeposit } from "@/lib/kis";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const deposit = await getDeposit();
    return NextResponse.json(deposit);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}
