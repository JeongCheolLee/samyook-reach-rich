import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { addDeposit, deleteDeposit, listDeposits } from "@/lib/deposits";
import { getMembers, saveMembers } from "@/lib/members";

const ADMIN_USER = process.env.ADMIN_USERNAME!;
const ADMIN_PASS = process.env.ADMIN_PASSWORD!;
const TOKEN = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString("base64");

async function isAdmin() {
  const cookieStore = await cookies();
  return cookieStore.get("admin_token")?.value === TOKEN;
}

export async function GET() {
  const deposits = await listDeposits();
  return NextResponse.json(deposits);
}

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const memberName = String(body?.memberName ?? "").trim();
  const amount = Number(body?.amount);
  const depositedAt = Number(body?.depositedAt);
  const memo = typeof body?.memo === "string" ? body.memo : undefined;

  if (!memberName || !Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }
  if (!Number.isFinite(depositedAt)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const members = await getMembers();
  const member = members.find((m) => m.name === memberName);
  if (!member) {
    return NextResponse.json({ error: "member not found" }, { status: 404 });
  }

  const deposit = await addDeposit({ memberName, amount, depositedAt, memo });

  const updatedMembers = members.map((m) =>
    m.name === memberName
      ? { ...m, totalContributed: m.totalContributed + amount }
      : m
  );
  await saveMembers(updatedMembers);

  return NextResponse.json({
    deposit,
    deposits: await listDeposits(),
    members: await getMembers(),
  });
}

export async function DELETE(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const removed = await deleteDeposit(id);
  if (!removed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const members = await getMembers();
  const updatedMembers = members.map((m) =>
    m.name === removed.memberName
      ? { ...m, totalContributed: m.totalContributed - removed.amount }
      : m
  );
  await saveMembers(updatedMembers);

  return NextResponse.json({
    deposits: await listDeposits(),
    members: await getMembers(),
  });
}
