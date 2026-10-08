import { NextResponse } from "next/server";
import { addDeposit, deleteDeposit, listDeposits } from "@/lib/deposits";
import { getMembers } from "@/lib/members";
import { requireAdmin } from "@/server/auth";
import { apiError, validId } from "@/server/api-errors";

export async function GET() {
  return NextResponse.json(await listDeposits());
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (!body || !validId(body.memberId) || !Number.isSafeInteger(body.amount) || body.amount === 0 ||
      !Number.isSafeInteger(body.depositedAt) || !Number.isFinite(new Date(body.depositedAt).getTime()) ||
      (body.memo !== undefined && (typeof body.memo !== "string" || body.memo.length > 1000))) {
    return NextResponse.json({ error: "멤버, 금액 또는 날짜를 확인해주세요" }, { status: 400 });
  }
  try {
    const deposit = await addDeposit({ memberId: body.memberId, amount: body.amount, depositedAt: body.depositedAt, memo: body.memo });
    const [deposits, members] = await Promise.all([listDeposits(), getMembers()]);
    return NextResponse.json({ deposit, deposits, members });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!validId(id)) return NextResponse.json({ error: "잘못된 id입니다" }, { status: 400 });
  try {
    const removed = await deleteDeposit(id);
    if (!removed) return NextResponse.json({ error: "기록을 찾을 수 없습니다" }, { status: 404 });
    const [deposits, members] = await Promise.all([listDeposits(), getMembers()]);
    return NextResponse.json({ deposits, members });
  } catch (error) { return apiError(error); }
}
