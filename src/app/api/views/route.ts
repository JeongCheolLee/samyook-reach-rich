import { NextResponse } from "next/server";
import { bumpViews, getViews } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getViews());
}

export async function POST() {
  return NextResponse.json(await bumpViews());
}
