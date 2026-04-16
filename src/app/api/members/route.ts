import { NextResponse } from "next/server";
import { getMembers, saveMembers } from "@/lib/members";
import type { Member } from "@/lib/mock-data";

export async function GET() {
  const members = getMembers();
  return NextResponse.json(members);
}

export async function PUT(request: Request) {
  const members: Member[] = await request.json();
  saveMembers(members);
  return NextResponse.json(getMembers());
}
